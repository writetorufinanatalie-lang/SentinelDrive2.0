import io
import time

import cv2
import numpy as np
import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SENTINEL_GEOCODER", "off")
    from app import config, db, potholes

    monkeypatch.setattr(config, "MEDIA_DIR", tmp_path / "media")
    monkeypatch.setattr(potholes, "MEDIA_DIR", tmp_path / "media")
    (tmp_path / "media").mkdir()
    db.reset_for_tests(tmp_path / "test.db")

    # Deterministic detector so tests do not depend on model files.
    def fake_detect(bgr):
        if bgr.mean() > 250:  # pure white image = empty road
            return []
        h, w = bgr.shape[:2]
        return [{"bbox": {"x": w // 3, "y": int(h * 0.7), "w": w // 4, "h": h // 8}, "confidence": 0.82,
                 "detection_source": "yolo"}]

    monkeypatch.setattr(potholes.detector, "detect", fake_detect)
    from app import auth
    monkeypatch.setattr(config, "STAFF_PASSWORD", "test-pass")
    monkeypatch.setattr(auth, "_password", None)
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _jpeg(color=(90, 90, 90), sky=True):
    img = np.full((480, 640, 3), color, np.uint8)
    if sky:
        img[:160] = (235, 206, 135)
    ok, buf = cv2.imencode(".jpg", img)
    return io.BytesIO(buf.tobytes())


def _noisy(seed=1):
    rng = np.random.default_rng(seed)
    img = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    return io.BytesIO(buf.tobytes())


def _upload(c, lat=13.0105, lng=80.2354, img=None, reporter=None):
    data = {} if lat is None else {"lat": str(lat), "lng": str(lng), "accuracy_m": "5"}
    if reporter:
        data["reporter"] = reporter
    return c.post("/api/potholes/upload", files={"file": ("road.jpg", img or _noisy(), "image/jpeg")}, data=data)


def test_health(client):
    r = client.get("/api/health").json()
    assert r["ok"] and r["detector"]["tier"] in ("yolo-onnx", "yolo", "classical")


def test_upload_creates_site_with_inr_estimate(client):
    r = _upload(client)
    assert r.status_code == 200
    site = r.json()["site"]
    assert site["id"].startswith("PH-")
    assert site["count"] == 1 and site["status"] == "reported"
    est = site["estimate"]
    assert est["currency"] == "INR"
    assert est["total"] == pytest.approx(est["subtotal"] * 1.18, abs=0.02)
    d = site["defects"][0]
    assert 0.02 <= d["depth_m"] <= 0.12 and 0 < d["area_m2"] < 5
    assert site["evidence"][0]["annotated"].startswith("/media/")


def test_empty_road_creates_nothing(client):
    r = _upload(client, img=_jpeg((255, 255, 255), sky=False))
    assert r.json()["site"] is None
    assert client.get("/api/potholes").json() == []


def test_nearby_report_merges(client):
    first = _upload(client).json()["site"]
    second = _upload(client, lat=13.01053, lng=80.23542).json()  # ~4 m away
    assert second["action"] == "merged"
    assert second["site"]["id"] == first["id"]
    assert second["site"]["reports"] == 2
    far = _upload(client, lat=13.02, lng=80.24).json()
    assert far["action"] == "created"
    assert len(client.get("/api/potholes").json()) == 2


def staff(c, who="officer"):
    r = c.post("/api/auth/login", json={"username": who, "password": "test-pass"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def act(c, sid, who, action, **kw):
    return c.post(f"/api/municipal/cases/{sid}/action", json={"action": action, **kw}, headers=staff(c, who))


def test_no_gps_then_set_on_map(client):
    site = _upload(client, lat=None, reporter="me").json()["site"]
    assert site["lat"] is None and site["gps_source"] == "none"
    # a stranger cannot place it; the reporter can; once placed it is locked
    assert client.post(f"/api/potholes/{site['id']}/location", json={"reporter": "other", "lat": 12.97, "lng": 77.59}).status_code == 403
    r = client.post(f"/api/potholes/{site['id']}/location", json={"reporter": "me", "lat": 12.97, "lng": 77.59})
    assert r.json()["gps_source"] == "set-on-map"
    assert client.post(f"/api/potholes/{site['id']}/location", json={"reporter": "me", "lat": 1, "lng": 1}).status_code == 409


def test_full_repair_workflow_and_roles(client):
    sid = _upload(client, reporter="citizen-1").json()["site"]["id"]
    # the old open door is gone
    assert client.patch(f"/api/potholes/{sid}", json={"status": "verified"}).status_code == 405
    assert client.delete(f"/api/potholes/{sid}").status_code == 405
    # no token / citizen cannot use municipal endpoints
    assert client.post(f"/api/municipal/cases/{sid}/action", json={"action": "acknowledge"}).status_code == 401
    assert client.get("/api/municipal/summary").status_code == 401
    # roles are enforced on the server
    assert act(client, sid, "repairteam", "acknowledge").status_code == 403
    assert act(client, sid, "officer", "verify").status_code == 403
    assert act(client, sid, "officer", "assign", team="Zone A repair crew").status_code == 409  # not acknowledged yet
    assert act(client, sid, "officer", "acknowledge").json()["status"] == "acknowledged"
    assert act(client, sid, "officer", "assign", team="No such team").status_code == 400
    r = act(client, sid, "officer", "assign", team="Zone A repair crew", internal_note="gate code 1234")
    assert r.json()["status"] == "assigned"
    # completion needs the in-progress state and a real photo
    photo = {"file": ("after.jpg", _jpeg(), "image/jpeg")}
    assert client.post(f"/api/municipal/cases/{sid}/complete", files=photo, headers=staff(client, "repairteam")).status_code == 409
    assert act(client, sid, "repairteam", "start").json()["status"] == "in_progress"
    assert client.post(f"/api/municipal/cases/{sid}/complete", files=photo, headers=staff(client, "officer")).status_code == 403
    bad = client.post(f"/api/municipal/cases/{sid}/complete", files={"file": ("x.jpg", b"nope", "image/jpeg")}, headers=staff(client, "repairteam"))
    assert bad.status_code == 422
    done = client.post(f"/api/municipal/cases/{sid}/complete", files=photo, data={"note": "Patched", "actual_cost": "1500"}, headers=staff(client, "repairteam"))
    assert done.status_code == 200 and done.json()["status"] == "completed" and done.json()["repair"]["photo"].endswith(".jpg")
    # the repair team cannot verify its own work; only the verifier can
    assert act(client, sid, "repairteam", "verify").status_code == 403
    # a rejection needs a reason, reopens the case and keeps the old photo
    assert act(client, sid, "verifier", "reject_repair").status_code == 400
    r = act(client, sid, "verifier", "reject_repair", reason="Edges not sealed")
    assert r.json()["status"] == "reopened" and r.json().get("repair") is None
    assert act(client, sid, "officer", "assign", team="Zone A repair crew").json()["status"] == "assigned"
    act(client, sid, "repairteam", "start")
    client.post(f"/api/municipal/cases/{sid}/complete", files=photo, headers=staff(client, "repairteam"))
    v = act(client, sid, "verifier", "verify", note="Looks good")
    assert v.json()["status"] == "verified" and v.json()["verification"]["result"] == "accepted"
    # public view: no staff names, no internal notes, no reporter ids
    pub = client.get(f"/api/potholes/{sid}").json()
    assert "reporters" not in pub and "internal_note" not in pub["assignment"]
    assert all("gate code" not in h["note"] for h in pub["history"])
    assert all(h.get("by") in (None, "Citizen", "Municipal officer", "Repair team", "Verifier") for h in pub["history"])
    assert [h["status"] for h in pub["history"]][0] == "reported" and pub["history"][-1]["status"] == "verified"
    # reports
    pdf = client.get(f"/api/potholes/{sid}/verification.pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    # citizen was told at every step
    codes = [n["code"] for n in client.get("/api/citizen/notifications", params={"reporter": "citizen-1"}).json()]
    for c in ("acknowledged", "assigned", "in_progress", "completed", "reopened", "verified"):
        assert c in codes, c
    # audit trail is verifier-only and records who did what
    assert client.get("/api/municipal/audit", headers=staff(client, "officer")).status_code == 403
    rows = client.get("/api/municipal/audit", headers=staff(client, "verifier")).json()
    assert any(x["by"] == "verifier" and x["to"] == "verified" for x in rows)


def test_reject_not_a_pothole_and_delete_rules(client):
    sid = _upload(client).json()["site"]["id"]
    assert act(client, sid, "officer", "reject").status_code == 400  # reason needed
    assert act(client, sid, "officer", "reject", reason="Just a shadow").json()["status"] == "rejected"
    assert client.delete(f"/api/municipal/cases/{sid}", headers=staff(client, "officer")).status_code == 403
    assert client.delete(f"/api/municipal/cases/{sid}", headers=staff(client, "verifier")).status_code == 200


def test_login_rules(client):
    assert client.post("/api/auth/login", json={"username": "officer", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "nobody", "password": "test-pass"}).status_code == 401
    tok = staff(client)["Authorization"]
    assert client.get("/api/auth/me", headers={"Authorization": tok + "x"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": tok}).json()["role"] == "officer"


def test_priority_override_needs_reason_and_keeps_calculation(client):
    sid = _upload(client).json()["site"]["id"]
    assert act(client, sid, "officer", "override_priority", category="critical").status_code == 400
    r = act(client, sid, "officer", "override_priority", category="critical", reason="School zone").json()
    info = r["priority_info"]
    assert info["category"] == "critical" and info["overridden"] and info["calculated_category"] != "" and "calculated_score" in info
    pub = client.get(f"/api/potholes/{sid}").json()
    assert "reason" not in pub["priority_override"]


def test_duplicate_confirmation_flow(client):
    a = _upload(client, reporter="A").json()["site"]
    # a clearly different picture 3 m away: the app asks instead of guessing
    r = _upload(client, lat=13.01052, lng=80.2354, img=_noisy(7), reporter="B").json()
    assert r.get("needs_confirmation") and r["candidate"]["id"] == a["id"] and r["site"] is None
    assert len(client.get("/api/potholes").json()) == 1  # nothing saved yet
    same = client.post("/api/potholes/upload", files={"file": ("a.jpg", _noisy(7), "image/jpeg")}, data={"lat": "13.01052", "lng": "80.2354", "reporter": "B", "same_as": a["id"]}).json()
    assert same["action"] == "merged" and same["site"]["citizens"] == 2
    staff_case = client.get(f"/api/municipal/cases/{a['id']}", headers=staff(client)).json()
    assert staff_case["needs_review"] is True  # citizen said yes, the photos did not clearly agree
    diff = client.post("/api/potholes/upload", files={"file": ("a.jpg", _noisy(9), "image/jpeg")}, data={"lat": "13.01052", "lng": "80.2354", "reporter": "C", "same_as": "new"}).json()
    assert diff["action"] == "created" and diff["site"]["id"] != a["id"]


def test_municipal_summary_and_cases_filters(client):
    for i in range(3):
        _upload(client, lat=13.01 + i * 0.01, lng=80.2, reporter=f"c{i}")
    s = client.get("/api/municipal/summary", headers=staff(client)).json()
    assert s["cards"]["unique_cases"] == 3 and s["cards"]["awaiting_ack"] == 3 and s["cards"]["citizens_affected"] == 3
    page = client.get("/api/municipal/cases", params={"limit": 2, "sort": "newest"}, headers=staff(client)).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    one = page["items"][0]["id"]
    assert client.get("/api/municipal/cases", params={"q": one.lower()}, headers=staff(client)).json()["total"] == 1
    assert client.get("/api/municipal/cases", params={"status": "verified"}, headers=staff(client)).json()["total"] == 0
    kinds = {n["code"] for n in client.get("/api/municipal/notifications", headers=staff(client)).json()}
    assert "new_case" in kinds


def test_overdue_case_is_flagged_and_notified(client, monkeypatch):
    from app import potholes
    sid = _upload(client).json()["site"]["id"]
    monkeypatch.setattr(potholes, "OVERDUE_DAYS", 0.0)
    s = client.get("/api/municipal/summary", headers=staff(client)).json()
    assert s["cards"]["overdue"] == 1
    assert "overdue" in {n["code"] for n in client.get("/api/municipal/notifications", headers=staff(client)).json()}


def test_work_order_pdf_and_csv(client):
    sid = _upload(client).json()["site"]["id"]
    r = client.get(f"/api/potholes/{sid}/work-order.pdf")
    assert r.status_code == 200 and r.content[:5] == b"%PDF-"
    csv = client.get("/api/potholes/export.csv").text
    assert sid in csv and "INR" in csv
    assert client.get("/api/potholes/PH-NOPE/work-order.pdf").status_code == 404


def test_rate_card_update_and_recalculate(client):
    sid = _upload(client).json()["site"]["id"]
    before = client.get(f"/api/potholes/{sid}").json()["estimate"]["total"]
    assert client.put("/api/settings/rate-card", json={"gst_pct": 0}).status_code == 401  # staff only
    h = staff(client)
    client.put("/api/settings/rate-card", json={"labour_per_patch": 5000, "gst_pct": 0}, headers=h)
    client.post("/api/potholes/recalculate", headers=h)
    after = client.get(f"/api/potholes/{sid}").json()["estimate"]
    assert after["gst"] == 0 and after["total"] != before
    assert client.put("/api/settings/rate-card", json={"gst_pct": -1}, headers=h).status_code == 400


def test_b2g_requires_key(client):
    _upload(client)
    assert client.get("/api/b2g/work-orders").status_code == 401
    rows = client.get("/api/b2g/work-orders", headers={"X-API-Key": "change-me"}).json()
    assert len(rows) == 1 and rows[0]["work_order_pdf"].endswith(".pdf")


def test_multi_frame_upload_picks_a_frame(client):
    r = client.post(
        "/api/potholes/upload",
        files=[("file", ("f0.jpg", _jpeg((255, 255, 255), sky=False), "image/jpeg")),
               ("frames", ("f1.jpg", _jpeg(), "image/jpeg")),
               ("frames", ("f2.jpg", _jpeg((255, 255, 255), sky=False), "image/jpeg"))],
        data={"lat": "13.05", "lng": "80.25"},
    )
    j = r.json()
    assert j["frames_checked"] == 3 and j["detections"] == 1


def test_unique_citizens_and_privacy(client):
    a = _upload(client, reporter="citizen-A").json()["site"]
    assert a["citizens"] == 1
    b = _upload(client, lat=13.01051, lng=80.23541, reporter="citizen-B").json()
    assert b["action"] == "merged" and b["site"]["id"] == a["id"] and b["site"]["citizens"] == 2
    again = _upload(client, reporter="citizen-A").json()["site"]  # same person, same pothole
    assert again["citizens"] == 2 and again["reports"] == 3
    rec = client.get(f"/api/potholes/{a['id']}").json()
    assert "reporters" not in rec and all("reporter" not in e for e in rec["evidence"])
    # My reports: only own sites
    assert len(client.get("/api/potholes", params={"reporter": "citizen-B"}).json()) == 1
    assert client.get("/api/potholes", params={"reporter": "nobody"}).json() == []
    assert client.get("/api/potholes", params={"reporter": ""}).json() == []


def test_priority_grows_with_citizens_but_is_capped():
    from app import rates

    one = rates.priority_info("medium", 1, 0, 1, 0.3)["score"]
    five = rates.priority_info("medium", 5, 0, 1, 0.3)["score"]
    huge = rates.priority_info("medium", 500, 0, 1, 0.3)["score"]
    cap = rates.priority_info("medium", 15, 0, 1, 0.3)["score"]
    assert one < five < cap and huge == cap
    assert rates.priority_info("high", 15, 14, 3, 2.0)["category"] == "critical"


def test_old_status_names_are_migrated(client):
    from app import db, potholes

    sid = _upload(client).json()["site"]["id"]
    rec = db.get("potholes", sid)
    rec.pop("schema", None)
    rec["status"] = "scheduled"
    rec["history"][0]["status"] = "verified"
    db.put("potholes", rec)
    potholes.migrate()
    new = db.get("potholes", sid)
    assert new["status"] == "assigned" and new["history"][0]["status"] == "acknowledged" and new["schema"] == 2

"""How alike two road photos are (0 to 1). Used only to decide if a nearby report is the same pothole.

It counts ORB feature matches. It is a simple, explainable check, not a guarantee:
two shots of one pothole from different angles can score low, so a low score asks the
citizen instead of rejecting the match.
"""

import cv2


def _gray(img, side=640):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    h, w = g.shape[:2]
    s = side / max(h, w)
    return cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else g


def similarity(a, b):
    """Return 0..1, or None when a photo has too little texture to compare."""
    orb = cv2.ORB_create(nfeatures=500)
    ka, da = orb.detectAndCompute(_gray(a), None)
    kb, db_ = orb.detectAndCompute(_gray(b), None)
    if da is None or db_ is None or len(ka) < 15 or len(kb) < 15:
        return None
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db_)
    good = [m for m in matches if m.distance < 50]
    return round(len(good) / float(min(len(ka), len(kb))), 3)

import time

import pytest


def wait(client, job):
    for _ in range(200):
        j = client.get(f"/api/jobs/{job}").json()
        if j["status"] != "running":
            return j
        time.sleep(0.05)
    raise AssertionError("job never finished")


@pytest.fixture
def sample(client):
    return client.post("/api/projects", json={"sample": True}).json()


def test_meta_lists_frameworks_and_limits(client):
    meta = client.get("/api/meta").json()
    assert meta["director"] == "scripted"
    assert {"three-act", "save-the-cat", "pas", "story-spine"} <= {f["id"] for f in meta["frameworks"]}
    assert meta["limits"]["references"] == 5


def test_sample_gets_fresh_ids(client):
    a = client.post("/api/projects", json={"sample": True}).json()
    b = client.post("/api/projects", json={"sample": True}).json()
    assert a["id"] != b["id"] and a["messages"][0]["id"] != b["messages"][0]["id"]


def test_patch_and_list(client, sample):
    pid = sample["id"]
    s = sample["settings"] | {"duration": 30, "aspect": "9:16"}
    client.patch(f"/api/projects/{pid}", json={"name": "Vertical cut", "settings": s})
    p = client.get(f"/api/projects/{pid}").json()
    assert p["name"] == "Vertical cut" and p["settings"]["aspect"] == "9:16"
    assert client.get("/api/projects").json()[0]["id"] == pid


def test_script_needs_a_brief(client):
    pid = client.post("/api/projects", json={}).json()["id"]
    assert client.post(f"/api/projects/{pid}/script", json={}).status_code == 400


def test_upload_script_and_cleanup(client, sample, image):
    pid = sample["id"]
    asset = client.post(
        f"/api/projects/{pid}/assets", files={"file": ("screen.png", image.read_bytes(), "image/png")}
    ).json()
    assert (asset["width"], asset["height"]) == (1440, 900)
    logo = client.post(
        f"/api/projects/{pid}/assets", files={"file": ("logo.png", image.read_bytes(), "image/png")}
    ).json()
    client.patch(f"/api/projects/{pid}", json={"brand": sample["brand"] | {"logo": logo["id"]}})
    out = client.post(f"/api/projects/{pid}/script", json={"style": {"avg_shot": 3}}).json()
    scenes = out["project"]["scenes"]
    used = {s["asset"] for s in scenes}
    assert asset["id"] in used and logo["id"] not in used  # the logo has its own moments
    assert all(v > 0 for v in out["coverage"].values())
    # Deleting media takes it out of every scene.
    client.delete(f"/api/projects/{pid}/assets/{asset['id']}")
    p = client.get(f"/api/projects/{pid}").json()
    assert all(s["asset"] != asset["id"] for s in p["scenes"])


def test_rewrite_and_suggest(client, sample):
    pid = sample["id"]
    scene = client.post(f"/api/projects/{pid}/script", json={}).json()["project"]["scenes"][1]
    out = client.post(f"/api/projects/{pid}/scenes/{scene['id']}/rewrite", json={"instruction": "As a question"}).json()
    assert out["narration"].endswith("?")
    assert len(client.post(f"/api/projects/{pid}/messages/suggest").json()["messages"]) == 3


def test_reference_from_a_file(client, sample, reference):
    pid = sample["id"]
    r = client.post(
        f"/api/projects/{pid}/references/upload", files={"file": ("ref.mp4", reference.read_bytes(), "video/mp4")}
    )
    job = wait(client, r.json()["job"])
    p = client.get(f"/api/projects/{pid}").json()
    # The test limit is 8 s, so this 10 s video is refused, and nothing of it is kept.
    assert job["status"] == "failed" and p["references"][0]["status"] == "failed"
    assert "longer than" in p["references"][0]["error"]


def test_reference_limits(client, sample, settings):
    pid = sample["id"]
    assert client.post(f"/api/projects/{pid}/references", json={"url": "not a link"}).status_code == 400
    settings.max_references = 1
    client.post(f"/api/projects/{pid}/references", json={"url": "http://127.0.0.1:9/a.mp4"})
    r = client.post(f"/api/projects/{pid}/references", json={"url": "http://127.0.0.1:9/b.mp4"})
    assert r.status_code == 400 and "Up to 1" in r.json()["detail"]


def test_files_stay_inside_the_project(client, sample):
    assert client.get(f"/api/projects/{sample['id']}/files/../../reel.db").status_code == 404


def test_render_needs_a_script(client, sample):
    assert client.post(f"/api/projects/{sample['id']}/render", json={}).status_code == 400

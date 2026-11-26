"""AI advisor. Uses a self-hosted open-source model via Ollama when OLLAMA_URL is set,
otherwise a built-in rule-based advisor. It only ever answers in text: it never edits the plan."""
import json
import os
import urllib.request

import catalog

CAVEAT = "Moving or removing walls, changing openings or wet areas needs assessment by a qualified professional."
NEEDS = {"living": ("sofa3", "coffee", "tvunit"), "bedroom": ("bed160", "wardrobe", "nightstand"),
         "kitchen": ("kitchen_unit",), "bath": ("toilet", "vanity"), "dining": ("dining4",), "office": ("desk", "officechair")}


def context(project, plan, brief, est):
    rooms = [{"name": r["name"], "m2": round(r["w"] * r["h"] / 1e4, 1)} for r in plan.get("rooms", [])]
    furn = [catalog.FURN[f["ref"]]["name"] for f in plan.get("furniture", []) if f.get("ref") in catalog.FURN]
    return {"project": project["name"], "kind": project["kind"], "brief": brief, "rooms": rooms, "furniture": furn,
            "estimate_eur": est["total"]}


def _rules(msg, ctx, plan):
    m, out, b = msg.lower(), [], ctx["brief"]
    style = b.get("style") or "your chosen style"
    if any(w in m for w in ("wall", "partition", "open plan", "knock", "remove", "move the door", "window")):
        out.append("Idea: removing or shifting a non-structural partition could connect the spaces and add light. "
                   "I have NOT changed your plan; if you like it, draw it yourself and mark it for review. " + CAVEAT)
    for r in plan.get("rooms", []):
        name = r["name"].lower()
        inside = {f["ref"] for f in plan.get("furniture", []) if r["x"] <= f["x"] + f["w"] / 2 <= r["x"] + r["w"]
                  and r["y"] <= f["y"] + f["d"] / 2 <= r["y"] + r["h"]}
        for key, refs in NEEDS.items():
            if key in name:
                miss = [catalog.FURN[x]["name"] for x in refs if x not in inside]
                if miss:
                    out.append("%s: consider adding %s." % (r["name"], ", ".join(miss)))
        if r["w"] * r["h"] / 1e4 < 6 and "sofa3" in inside:
            out.append("%s is small for a 3-seat sofa; an armchair would keep walking space." % r["name"])
    budget = b.get("budget")
    try:
        if budget and ctx["estimate_eur"] > float(budget):
            out.append("Your estimate (€%d) is above your budget (€%s). Swap the priciest items for cheaper generic options."
                       % (ctx["estimate_eur"], budget))
    except ValueError:
        pass
    if any(w in m for w in ("color", "colour", "paint", "palette", "material", "floor")):
        out.append("For %s try light oak floors, warm white walls and one accent (terracotta or brass)." % style)
    if any(w in m for w in ("alternative", "option", "concept")):
        out.append("Alternatives: 1) calm Japandi (oak, limewash, linen); 2) bold Industrial (concrete, navy, black steel); "
                   "3) soft Coastal (white, sage, rattan). Save each as a plan version and compare renders.")
    if not out:
        out.append("Tell me what you want to improve: layout, colours, furniture or budget. "
                   "Your plan has %d rooms and an estimate of €%d." % (len(ctx["rooms"]), ctx["estimate_eur"]))
    return "\n".join("• " + o for o in out)


def answer(msg, history, ctx, plan):
    url = os.environ.get("OLLAMA_URL")
    if url:
        system = ("You are an interior design advisor. Answer briefly using this project context: %s. "
                  "You cannot modify the plan. For walls/openings/wet areas say: %s") % (json.dumps(ctx), CAVEAT)
        body = {"model": os.environ.get("OLLAMA_MODEL", "llama3.2"), "stream": False,
                "messages": [{"role": "system", "content": system}] + history[-10:] + [{"role": "user", "content": msg}]}
        try:
            req = urllib.request.Request(url.rstrip("/") + "/api/chat", json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)["message"]["content"]
        except Exception:
            pass  # fall back to the rule-based advisor
    return _rules(msg, ctx, plan)

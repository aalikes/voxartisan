import os
import json
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_session import Session
import google.generativeai as genai
from google_auth_oauthlib.flow import Flow
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import pathlib
import requests

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key-change-in-prod")

# Flask-Session config
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_PERMANENT"] = False
Session(app)

# Gemini config
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", ""))

# Google OAuth config
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("REDIRECT_URI", "http://localhost:5000/callback")

os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"  # Dev only — remove in prod HTTPS

LOCAL_MODE = os.environ.get("LOCAL_MODE", "").lower() == "true"
LOCAL_USER = {"name": "Shah", "email": "aalikes@gmail.com", "picture": ""}

CLIENT_SECRETS = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [REDIRECT_URI],
    }
}


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.route("/login")
def login():
    flow = Flow.from_client_config(
        CLIENT_SECRETS,
        scopes=["openid", "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile"],
        redirect_uri=REDIRECT_URI,
    )
    auth_url, state = flow.authorization_url(prompt="consent")
    session["state"] = state
    return redirect(auth_url)


@app.route("/callback")
def callback():
    flow = Flow.from_client_config(
        CLIENT_SECRETS,
        scopes=["openid", "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile"],
        redirect_uri=REDIRECT_URI,
        state=session.get("state"),
    )
    flow.fetch_token(authorization_response=request.url)
    credentials = flow.credentials
    id_info = id_token.verify_oauth2_token(
        credentials.id_token, google_requests.Request(), GOOGLE_CLIENT_ID
    )
    session["user"] = {
        "name": id_info.get("name"),
        "email": id_info.get("email"),
        "picture": id_info.get("picture"),
    }
    return redirect(url_for("builder"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


# ── Main routes ────────────────────────────────────────────────────────────────

@app.before_request
def auto_login_local():
    """In LOCAL_MODE, inject a default user so OAuth is never needed."""
    if LOCAL_MODE and not session.get("user"):
        session["user"] = LOCAL_USER


@app.route("/")
def index():
    user = session.get("user")
    return render_template("index.html", user=user)


@app.route("/builder")
def builder():
    if not session.get("user"):
        return redirect(url_for("login"))
    return render_template("builder.html", user=session["user"])


@app.route("/generate", methods=["POST"])
def generate():
    if not session.get("user"):
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    topic               = data.get("topic", "")
    pathway             = data.get("pathway", "")
    project             = data.get("project", "")
    story_line          = data.get("story_line", "")
    central_message     = data.get("central_message", "")
    intro_style         = data.get("intro_style", "Bold Statement")
    closing_technique   = data.get("closing_technique", "Callback to Opening")
    project_objectives  = data.get("project_objectives", "")
    audience            = data.get("audience", "general")
    duration            = data.get("duration", "5-7 minutes")
    tone                = data.get("tone", "professional")
    key_points          = data.get("key_points", "")

    pathway_line        = f"- Toastmasters Pathway: {pathway}" if pathway and pathway != "— Select a Pathway —" else ""
    project_line        = f"- Project: {project}" if project else ""
    story_line_text     = f"\nNarrative / Story Line to weave in:\n{story_line}" if story_line else ""
    central_msg_line    = f"- Central Message & CTA: {central_message}" if central_message else ""
    closing_line        = f"- Closing Technique: {closing_technique}"
    objectives_text     = f"\nProject Objectives to satisfy:\n{project_objectives}" if project_objectives else ""
    key_points_line     = f"- Key Points: {key_points}" if key_points else ""

    prompt = f"""You are VoxArtisan — an elite Toastmasters speech architect and coach. Craft a complete, performance-ready speech.

Speech Brief:
{pathway_line}
{project_line}
- Subject Matter: {topic}
- Audience: {audience}
- Duration: {duration}
- Tone: {tone}
- Opening Technique: {intro_style}
{central_msg_line}
{closing_line}
{key_points_line}
{story_line_text}
{objectives_text}

Deliver the full speech with:
1. A powerful HOOK opening using the "{intro_style}" technique — nail it in the first 30 seconds
2. Structured body with smooth transitions that supports the central message
3. Closing using the "{closing_technique}" technique — memorable, with a clear call-to-action
4. [Speaker notes in brackets] for emphasis, pauses, gestures, and vocal variety
5. Word count estimate at the end

Format sections clearly: TITLE → HOOK → BODY → CLOSE → SPEAKER NOTES → WORD COUNT"""

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        return jsonify({"speech": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/suggest", methods=["POST"])
def suggest():
    if not session.get("user"):
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    topic               = data.get("topic", "")
    pathway             = data.get("pathway", "")
    project             = data.get("project", "")
    tone                = data.get("tone", "")
    story_line          = data.get("story_line", "")
    central_message     = data.get("central_message", "")
    intro_style         = data.get("intro_style", "Bold Statement")
    closing_technique   = data.get("closing_technique", "Callback to Opening")
    duration            = data.get("duration", "5-7 minutes")

    context = f"Topic: {topic} | Pathway: {pathway} | Project: {project} | Tone: {tone} | Duration: {duration} | Preferred Intro Style: {intro_style} | Closing Technique: {closing_technique}"
    if central_message:
        context += f" | Central Message: {central_message}"
    if story_line:
        context += f" | Story: {story_line}"

    prompt = f"""You are VoxArtisan, an elite Toastmasters speech coach.

Based on this speech brief:
{context}

Return ONLY valid JSON (no markdown, no explanation) in this exact structure:
{{
  "titles": [
    "Title Option 1",
    "Title Option 2",
    "Title Option 3",
    "Title Option 4",
    "Title Option 5"
  ],
  "intros": [
    "Full opening using the {intro_style} technique — primary recommendation.",
    "Full opening using a different technique as an alternative — complete, speakable.",
    "Full opening using a third technique — bold, unexpected, or story-driven."
  ]
}}

Titles: punchy, memorable, fit the tone and subject.
Intros: complete speakable sentences (2-3 sentences max), first intro MUST use the "{intro_style}" technique, the other two use varied alternatives."""

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Strip markdown code fences if Gemini wraps in ```json ... ```
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text.strip())
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/refine", methods=["POST"])
def refine():
    if not session.get("user"):
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    original = data.get("speech", "")
    instruction = data.get("instruction", "")

    prompt = f"""You are an expert Toastmasters coach. Refine this speech based on the instruction below.

ORIGINAL SPEECH:
{original}

REFINEMENT INSTRUCTION:
{instruction}

Return the improved full speech text only."""

    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(prompt)
        return jsonify({"speech": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)

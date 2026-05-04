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
    topic        = data.get("topic", "")
    purpose      = data.get("purpose", "inform")
    audience     = data.get("audience", "general")
    duration     = data.get("duration", "5-7 minutes")
    tone         = data.get("tone", "professional")
    key_points   = data.get("key_points", "")
    speech_type  = data.get("speech_type", "Icebreaker")

    prompt = f"""You are an expert Toastmasters speech coach. Build a complete, competition-ready speech.

Speech Details:
- Title/Topic: {topic}
- Speech Type: {speech_type}
- Purpose: {purpose}
- Audience: {audience}
- Duration: {duration}
- Tone: {tone}
- Key Points to Include: {key_points}

Deliver the full speech text with:
1. A powerful HOOK opening (first 30 seconds)
2. Clear body with smooth transitions
3. Memorable closing call-to-action
4. Word count estimate
5. Speaker notes in [brackets] for emphasis, pauses, and gestures

Format as: TITLE | HOOK | BODY | CLOSE | SPEAKER NOTES | WORD COUNT"""

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(prompt)
        return jsonify({"speech": response.text})
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
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(prompt)
        return jsonify({"speech": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)

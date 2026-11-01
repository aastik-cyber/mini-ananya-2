# Memory Map

A location-based digital memory preservation and visualisation system (BCA project).
Stack: HTML/CSS/JavaScript, Leaflet.js + OpenStreetMap, Python Flask, SQLite (built-in `sqlite3`, no ORM).

## Run
    pip install -r requirements.txt
    python app.py
Open http://127.0.0.1:5000, create an account and click the map to add a memory.
The database (`memorymap.db`) and `static/uploads/` are created automatically.
Set a real secret before deploying:  `export SECRET_KEY="long-random-text"`

## Files
- `app.py` - routes, REST APIs, database tables (users, memories, photos, journeys, journey_memories)
- `templates/` - HTML pages    - `static/app.js` - map, forms, timeline, journeys, stats    - `static/style.css`

## Features
Signup/login (salted password hashes), add memory by map click or "Use my location", multiple photos,
markers with memory cards, edit/delete, search and filter (text, year, date, category, mood, place, tag),
timeline by year and month, On This Day, journeys with a drawn route, heatmap, statistics dashboard.
Maps need an internet connection (OpenStreetMap tiles).

## Version 2 additions
- Baby-pink theme, landing banner on login/signup, live banner on the map page (greeting, animated counters,
  rotating feature tips, memory of the day, Surprise me, hide/show)
- Favourites (heart), favourites-only filter, mood and category emojis, more moods/categories
- Place search on the map, auto place name from the map click, soft/street/satellite map layers
- Photo preview before upload, full-size photo viewer, toast messages
- Timeline search, category filter, sort and favourites
- Journeys show distance and have a Play button that animates the trip
- Statistics: streak, this month, favourites, badges
- Account page: change password; download all your data as JSON
Existing databases from version 1 are upgraded automatically.

## Slideshow
Press **Play slideshow** (map banner), **Play these as a slideshow** (filtered results) or **Slideshow** (timeline). One slide per photo, captions, auto-advance, pause, speed, shuffle, full screen. Keys: arrows, space, Esc.

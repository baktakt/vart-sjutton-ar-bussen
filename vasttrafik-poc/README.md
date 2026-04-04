# vasttrafik-poc

Data validation scripts for the Västtrafik GTFS PoC.

## Setup

1. Clone the repo
2. Run `npm install`
3. Copy `.env.example` to `.env` and add your Trafiklab API keys
   - Get keys at https://trafiklab.se (free account, add GTFS Regional to a project)
4. Run the scripts in order:

## Usage

```sh
node scripts/test-static.js       # Validate static GTFS data
node scripts/test-tripupdates.js  # Validate realtime delay data
node scripts/test-vehicles.js     # Check if vehicle positions are available
```

## What we're validating

- Whether Västtrafik has usable realtime data via Trafiklab GTFS Regional
- What vehicle types exist in the feed (trams, buses, trains, ferries)
- Whether VehiclePositions are available or if we need TripUpdates-only mode
- Data shape and field names for building the real app

## Scripts

### test-static.js
Downloads `vt.zip` from the GTFS Regional static feed, unzips in memory and reports:
- Total route count broken down by `route_type` with sample route names
- Total stop, trip, shape and stop-time counts
- Zip file size

### test-tripupdates.js
Fetches `TripUpdates.pb` from the GTFS-RT feed and reports:
- Feed timestamp and total entity count
- 3 sample entities (full JSON)
- Delay distribution (late / early / on time per stop-time update)
- Top 10 most frequent `route_id`s

### test-vehicles.js
Fetches `VehiclePositions.pb` and reports:
- If 404: prints a clear message that the app must use TripUpdates-only mode
- If available: vehicle count, feed timestamp, 3 sample vehicles, breakdown by type, bounding box

## Git setup

```sh
git init
git add .
git commit -m "init: GTFS data validation PoC scripts"
git remote add origin https://github.com/[YOUR_USERNAME]/vasttrafik-poc.git
git push -u origin main
```

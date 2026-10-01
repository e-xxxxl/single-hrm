import { env } from "../config/env.js";
import { logger } from "./logger.js";

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two [lat, lng] points, in metres. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Evaluate a point against a branch geofence.
 * Returns { checked, withinGeofence, distanceMeters, allowedRadiusMeters }.
 * `checked` is false when the branch has no coordinates configured.
 */
export function evaluateGeofence(branch, lat, lng) {
  const coords = branch?.location?.coordinates;
  if (!coords || coords.length !== 2) {
    return { checked: false, withinGeofence: null, distanceMeters: null, allowedRadiusMeters: null };
  }
  const [bLng, bLat] = coords;
  const distanceMeters = haversineMeters(lat, lng, bLat, bLng);
  const allowedRadiusMeters = branch.geofenceRadiusMeters ?? 200;
  return {
    checked: true,
    withinGeofence: distanceMeters <= allowedRadiusMeters,
    distanceMeters,
    allowedRadiusMeters,
  };
}

/**
 * Reverse-geocode a coordinate to a human-readable address. Best-effort — any
 * failure (no provider, network error, rate limit) resolves to "" so a
 * clock-in is never blocked by the geocoder being unavailable.
 */
export async function reverseGeocode(lat, lng) {
  try {
    if (env.geocodeProvider === "nominatim") {
      const url = new URL("/reverse", env.nominatimUrl);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("zoom", "18");
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": "hrm-platform/1.0 (attendance)" },
      });
      if (!res.ok) return "";
      const body = await res.json();
      return body.display_name || "";
    }

    if (env.geocodeProvider === "google" && env.geocodeApiKey) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("key", env.geocodeApiKey);
      const res = await fetchWithTimeout(url);
      if (!res.ok) return "";
      const body = await res.json();
      return body.results?.[0]?.formatted_address || "";
    }

    return "";
  } catch (err) {
    logger.warn("reverseGeocode failed:", err.message);
    return "";
  }
}

async function fetchWithTimeout(url, options = {}, ms = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default { haversineMeters, evaluateGeofence, reverseGeocode };

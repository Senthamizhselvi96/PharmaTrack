/**
 * Progressive Geocoding Engine for PharmaTrack
 *
 * Provides progressive fallback search, suggestions, and precision classification
 * for full addresses including street names, localities, PIN codes, cities, states, and countries.
 */

/**
 * Classifies the precision level of a Nominatim search result.
 *
 * @param {object} result - Nominatim result object
 * @param {boolean} isVerbatimMatch - Whether the search query was the exact, untrimmed address
 * @returns {'exact' | 'approximate_locality' | 'approximate_postal' | 'approximate_city'}
 */
export function classifyResultPrecision(result, isVerbatimMatch) {
  const rank = Number(result.place_rank || 0);
  const type = String(result.type || '').toLowerCase();
  const cls = String(result.class || '').toLowerCase();

  // Exact building / house / street match
  if (
    isVerbatimMatch &&
    (rank >= 26 ||
      ['building', 'amenity', 'shop', 'house', 'office'].includes(cls) ||
      ['residential', 'primary', 'secondary', 'tertiary', 'service', 'unclassified', 'living_street'].includes(type))
  ) {
    return 'exact';
  }

  // Locality / Suburb / Neighbourhood
  if (
    ['suburb', 'neighbourhood', 'locality', 'quarter', 'village', 'hamlet'].includes(type) ||
    (rank >= 18 && rank <= 22)
  ) {
    return 'approximate_locality';
  }

  // Postal code area
  if (type === 'postcode' || cls === 'postal_code' || (rank >= 21 && rank <= 25 && result.address?.postcode)) {
    return 'approximate_postal';
  }

  // City / Town / County / District
  return 'approximate_city';
}

/**
 * Progressively searches an address using OpenStreetMap Nominatim.
 *
 * Tries:
 * 1. Full verbatim address
 * 2. Progressive left-trimming (dropping house number, unmapped sub-street/colony)
 * 3. Postal code + City fallback
 *
 * @param {string} rawAddress - The complete user-entered address string
 * @returns {Promise<{
 *   success: boolean,
 *   error?: string,
 *   results: Array<{
 *     id: string|number,
 *     lat: number,
 *     lng: number,
 *     displayName: string,
 *     shortName: string,
 *     precision: 'exact' | 'approximate_locality' | 'approximate_postal' | 'approximate_city',
 *     isVerbatim: boolean,
 *     matchedQuery: string,
 *     unmatchedPart: string | null,
 *     type: string,
 *     rank: number
 *   }>,
 *   matchedCandidate?: { query: string, isVerbatim: boolean, unmatchedLabel: string | null }
 * }>}
 */
export async function searchAddressWithFallback(rawAddress) {
  const clean = String(rawAddress || '').trim();
  if (!clean) {
    return {
      success: false,
      error: 'Please enter a branch address to find on the map.',
      results: []
    };
  }

  // Split into components by comma
  const rawSegments = clean
    .split(',')
    .map(s => s.trim().replace(/^[-–—#\s]+/, '').replace(/[-–—\s]+$/, ''))
    .filter(Boolean);

  const candidatesToTry = [];

  // 1. Full verbatim address query
  candidatesToTry.push({
    query: clean,
    isVerbatim: true,
    unmatchedLabel: null
  });

  // 2. Progressive left-trimming (dropping door number, building, or unmapped sub-colony)
  // e.g., ["Mullai Nagar", "Ramapuram", "Chennai", "Tamil Nadu 600089", "India"]
  for (let i = 1; i < rawSegments.length; i++) {
    const trimmed = rawSegments.slice(i).join(', ');
    const unmatched = rawSegments.slice(0, i).join(', ');
    if (trimmed.length >= 3) {
      candidatesToTry.push({
        query: trimmed,
        isVerbatim: false,
        unmatchedLabel: unmatched
      });
    }
  }

  // 3. Fallback: PIN code + City/State if 6-digit postal code exists
  const pinMatch = clean.match(/\b\d{6}\b/);
  if (pinMatch) {
    const pin = pinMatch[0];
    const citySeg = rawSegments.find(s =>
      /chennai|mumbai|delhi|bangalore|bengaluru|kolkata|hyderabad|pune|ahmedabad|jaipur|coimbatore|madurai|trichy|salem/i.test(s)
    );
    if (citySeg) {
      candidatesToTry.push({
        query: `${pin}, ${citySeg}, India`,
        isVerbatim: false,
        unmatchedLabel: 'Detailed street/locality'
      });
    }
    candidatesToTry.push({
      query: `${pin}, India`,
      isVerbatim: false,
      unmatchedLabel: 'Detailed street/locality'
    });
  }

  let finalResults = [];
  let matchedCandidate = null;

  for (const candidate of candidatesToTry) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(candidate.query)}&addressdetails=1&limit=5`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PharmaTrack-App/1.0 (Branch Geocoding)'
        }
      });
      if (!response.ok) continue;

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        matchedCandidate = candidate;
        finalResults = data.map((d, index) => {
          const lat = Number(d.lat);
          const lng = Number(d.lon);
          const precision = classifyResultPrecision(d, candidate.isVerbatim);

          return {
            id: d.place_id || `${index}_${lat}_${lng}`,
            lat,
            lng,
            displayName: d.display_name,
            shortName: d.name || d.display_name.split(',')[0],
            precision,
            isVerbatim: candidate.isVerbatim,
            matchedQuery: candidate.query,
            unmatchedPart: candidate.unmatchedLabel,
            type: d.type,
            rank: Number(d.place_rank || 0),
            addressDetails: d.address || {}
          };
        });
        break; // Stop at first successful tier
      }
    } catch {
      // Continue to next fallback candidate
    }
  }

  if (finalResults.length === 0) {
    return {
      success: false,
      error: 'Could not find this address or its locality on the map. Please refine the address or click the map directly.',
      results: []
    };
  }

  return {
    success: true,
    results: finalResults,
    matchedCandidate
  };
}

/**
 * Geocodes an address using the Google Maps Geocoder API.
 * Distinguishes exact (ROOFTOP/RANGE_INTERPOLATED) from approximate (GEOMETRIC_CENTER/APPROXIMATE) matches.
 * Does NOT silently fall back to broad city coordinates when an address is not found.
 *
 * @param {string} rawAddress
 * @returns {Promise<{
 *   success: boolean,
 *   notFound?: boolean,
 *   error?: string,
 *   lat?: number,
 *   lng?: number,
 *   formattedAddress?: string,
 *   precision?: 'exact' | 'approximate',
 *   locationType?: string,
 *   matchedQuery?: string,
 *   suggestions?: Array<object>,
 *   results?: Array<object>
 * }>}
 */
export function geocodeAddressWithGoogle(rawAddress) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
      return resolve({ success: false, error: 'Google Maps Geocoder is not loaded' });
    }
    const clean = String(rawAddress || '').trim();
    if (!clean) {
      return resolve({ success: false, error: 'No address provided' });
    }

    try {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address: clean }, (results, status) => {
        if (status === 'OK' && Array.isArray(results) && results.length > 0) {
          const top = results[0];
          const lat = top.geometry.location.lat();
          const lng = top.geometry.location.lng();
          const locType = top.geometry.location_type;
          const isExact = locType === 'ROOFTOP' || locType === 'RANGE_INTERPOLATED';

          const suggestions = results.map((r, i) => {
            const rLat = r.geometry.location.lat();
            const rLng = r.geometry.location.lng();
            const rExact = r.geometry.location_type === 'ROOFTOP' || r.geometry.location_type === 'RANGE_INTERPOLATED';
            return {
              id: r.place_id || `${i}_${rLat}_${rLng}`,
              lat: rLat,
              lng: rLng,
              displayName: r.formatted_address,
              shortName: r.formatted_address.split(',')[0],
              precision: rExact ? 'exact' : 'approximate',
              matchedQuery: r.formatted_address,
              type: r.types?.[0] || 'geocode'
            };
          });

          resolve({
            success: true,
            lat,
            lng,
            formattedAddress: top.formatted_address,
            precision: isExact ? 'exact' : 'approximate',
            locationType: locType,
            matchedQuery: top.formatted_address,
            suggestions,
            results: suggestions
          });
        } else if (status === 'ZERO_RESULTS') {
          resolve({
            success: false,
            notFound: true,
            status,
            error: `Could not find "${clean}" on Google Maps. Please refine the street address or manually pin your location.`
          });
        } else {
          resolve({
            success: false,
            status,
            error: `Google Geocoding error (${status || 'UNKNOWN'}).`
          });
        }
      });
    } catch (err) {
      resolve({ success: false, error: err.message || 'Google geocoding failed' });
    }
  });
}

/**
 * Reverse-geocodes coordinates into an address string using Google Maps Geocoder API.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ success: boolean, formattedAddress?: string, error?: string }>}
 */
export function reverseGeocodeWithGoogle(lat, lng) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
      return resolve({ success: false, error: 'Google Maps Geocoder is not loaded' });
    }
    try {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: { lat: Number(lat), lng: Number(lng) } }, (results, status) => {
        if (status === 'OK' && Array.isArray(results) && results.length > 0) {
          resolve({
            success: true,
            formattedAddress: results[0].formatted_address,
            results
          });
        } else {
          resolve({
            success: false,
            error: `Reverse geocode failed (${status || 'UNKNOWN'})`
          });
        }
      });
    } catch (err) {
      resolve({ success: false, error: err.message || 'Google reverse geocode failed' });
    }
  });
}

/**
 * Reverse-geocodes coordinates using OpenStreetMap Nominatim.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ success: boolean, formattedAddress?: string, error?: string }>}
 */
export async function reverseGeocodeWithNominatim(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PharmaTrack-App/1.0 (Patient Location Reverse Geocoder)'
      }
    });
    if (!response.ok) return { success: false, error: 'Nominatim reverse geocode failed' };
    const data = await response.json();
    if (data && data.display_name) {
      return {
        success: true,
        formattedAddress: data.display_name,
        addressDetails: data.address
      };
    }
    return { success: false, error: 'No address found for these coordinates' };
  } catch (err) {
    return { success: false, error: err.message || 'Reverse geocoding network error' };
  }
}

/**
 * Unified reverse-geocoding helper: prefers Google Maps if active, falls back to Nominatim.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ success: boolean, formattedAddress?: string, source?: string, error?: string }>}
 */
export async function reverseGeocodeUnified(lat, lng) {
  if (typeof window !== 'undefined' && window.google?.maps?.Geocoder) {
    try {
      const googleRes = await reverseGeocodeWithGoogle(lat, lng);
      if (googleRes.success && googleRes.formattedAddress) {
        return { ...googleRes, source: 'google' };
      }
    } catch {
      // Fall through to Nominatim
    }
  }
  const nominatimRes = await reverseGeocodeWithNominatim(lat, lng);
  return { ...nominatimRes, source: 'nominatim' };
}

/**
 * Unified forward-geocoding helper: prefers Google Maps Geocoder if loaded, falls back to progressive OpenStreetMap.
 * When an address is not found, does NOT silently replace with broad city coordinates.
 *
 * @param {string} rawAddress
 * @returns {Promise<{
 *   success: boolean,
 *   lat?: number,
 *   lng?: number,
 *   precision?: string,
 *   matchedQuery?: string,
 *   results?: Array<object>,
 *   suggestions?: Array<object>,
 *   error?: string
 * }>}
 */
export async function geocodeAddressUnified(rawAddress) {
  const clean = String(rawAddress || '').trim();
  if (!clean) {
    return {
      success: false,
      error: 'Please enter an address to find on the map.',
      results: []
    };
  }

  // 1. If Google Maps Geocoder is available, attempt Google Geocoding first
  if (typeof window !== 'undefined' && window.google?.maps?.Geocoder) {
    try {
      const googleRes = await geocodeAddressWithGoogle(clean);
      if (googleRes.success) {
        return googleRes;
      }
      // If Google explicitly returned ZERO_RESULTS, do not guess broad coordinates
      if (googleRes.notFound) {
        return googleRes;
      }
    } catch {
      // Fall through to OpenStreetMap search
    }
  }

  // 2. OpenStreetMap progressive geocoding fallback
  const osmRes = await searchAddressWithFallback(clean);
  if (osmRes.success && osmRes.results?.length > 0) {
    const top = osmRes.results[0];
    return {
      success: true,
      lat: top.lat,
      lng: top.lng,
      precision: top.precision,
      matchedQuery: top.matchedQuery || top.displayName,
      results: osmRes.results,
      suggestions: osmRes.results,
      source: 'nominatim'
    };
  }

  return {
    success: false,
    error: osmRes.error || `Could not find "${clean}" on the map. Please refine the street address or manually pin your location.`,
    results: []
  };
}

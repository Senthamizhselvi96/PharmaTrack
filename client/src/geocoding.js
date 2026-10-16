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

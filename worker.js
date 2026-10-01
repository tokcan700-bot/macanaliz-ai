export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (!env.API_FOOTBALL_KEY) {
      return Response.json(
        { success: false, error: "API_FOOTBALL_KEY bulunamadı." },
        { status: 500, headers: cors }
      );
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/fixtures") {
      return fixtures(env, ctx, cors, url);
    }

    if (url.pathname === "/api/prediction") {
      return prediction(env, ctx, cors, url);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);

    return Response.json(
      { success: false, error: "Endpoint bulunamadı." },
      { status: 404, headers: cors }
    );
  }
};

async function fixtures(env, ctx, cors, url) {
  const date =
    url.searchParams.get("date") ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/fixtures?date=${encodeURIComponent(date)}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const apiUrl = new URL("https://v3.football.api-sports.io/fixtures");
  apiUrl.searchParams.set("date", date);
  apiUrl.searchParams.set("timezone", "Europe/Istanbul");

  const response = await fetch(apiUrl.toString(), {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
  });
  const data = await response.json();

  const errors = data.errors && typeof data.errors === "object"
    ? Object.keys(data.errors)
    : [];

  if (!response.ok || errors.length) {
    return Response.json(
      { success: false, status: response.status, errors: data.errors || {} },
      { status: 502, headers: cors }
    );
  }

  const matches = (data.response || []).map(m => ({
    id: m.fixture.id,
    kickoff: m.fixture.date,
    status: m.fixture.status.short,
    league: {
      name: m.league.name,
      country: m.league.country,
      logo: m.league.logo
    },
    home: {
      name: m.teams.home.name,
      logo: m.teams.home.logo
    },
    away: {
      name: m.teams.away.name,
      logo: m.teams.away.logo
    },
    score: {
      home: m.goals.home,
      away: m.goals.away
    }
  }));

  const result = Response.json(
    { success: true, date, count: matches.length, matches },
    { headers: { ...cors, "Cache-Control": "public, max-age=600" } }
  );

  ctx.waitUntil(cache.put(cacheKey, result.clone()));
  return result;
}

async function prediction(env, ctx, cors, url) {
  const fixture = url.searchParams.get("fixture");

  if (!fixture || !/^\d+$/.test(fixture)) {
    return Response.json(
      { success: false, error: "Geçerli fixture ID gerekli." },
      { status: 400, headers: cors }
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/prediction?fixture=${fixture}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const apiUrl = new URL("https://v3.football.api-sports.io/predictions");
  apiUrl.searchParams.set("fixture", fixture);

  const response = await fetch(apiUrl.toString(), {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
  });
  const data = await response.json();

  const errors = data.errors && typeof data.errors === "object"
    ? Object.keys(data.errors)
    : [];

  if (!response.ok || errors.length) {
    return Response.json(
      { success: false, status: response.status, errors: data.errors || {} },
      { status: 502, headers: cors }
    );
  }

  const item = data.response?.[0];
  if (!item) {
    return Response.json(
      { success: false, error: "Bu maç için tahmin verisi yok." },
      { status: 404, headers: cors }
    );
  }

  const p = item.predictions || {};
  const payload = {
    success: true,
    fixture: Number(fixture),
    prediction: {
      winner: p.winner?.name || null,
      winnerComment: p.winner?.comment || null,
      winOrDraw: p.win_or_draw ?? null,
      underOver: p.under_over || null,
      advice: p.advice || null,
      goals: {
        home: p.goals?.home ?? null,
        away: p.goals?.away ?? null
      },
      percent: {
        home: p.percent?.home || null,
        draw: p.percent?.draw || null,
        away: p.percent?.away || null
      }
    }
  };

  const result = Response.json(payload, {
    headers: { ...cors, "Cache-Control": "public, max-age=3600" }
  });

  ctx.waitUntil(cache.put(cacheKey, result.clone()));
  return result;
}

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

    if (url.pathname === "/api/model") {
      return model(env, ctx, cors, url);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return Response.json(
      { success: false, error: "Endpoint bulunamadı." },
      { status: 404, headers: cors }
    );
  }
};

async function apiFetch(path, params, env) {
  const u = new URL("https://v3.football.api-sports.io" + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      u.searchParams.set(k, String(v));
    }
  }

  const r = await fetch(u.toString(), {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
  });

  const data = await r.json();

  const errors =
    data.errors && typeof data.errors === "object"
      ? Object.keys(data.errors)
      : [];

  if (!r.ok || errors.length) {
    const e = new Error("API Football isteği başarısız.");
    e.status = r.status;
    e.apiErrors = data.errors || {};
    throw e;
  }

  return data;
}

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
  const cacheKey = new Request(
    `${url.origin}/api/fixtures?date=${encodeURIComponent(date)}`
  );

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const data = await apiFetch(
      "/fixtures",
      { date, timezone: "Europe/Istanbul" },
      env
    );

    const matches = (data.response || []).map(m => ({
      id: m.fixture.id,
      kickoff: m.fixture.date,
      status: m.fixture.status.short,
      league: {
        id: m.league.id,
        name: m.league.name,
        country: m.league.country,
        logo: m.league.logo
      },
      home: {
        id: m.teams.home.id,
        name: m.teams.home.name,
        logo: m.teams.home.logo
      },
      away: {
        id: m.teams.away.id,
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
      {
        headers: {
          ...cors,
          "Cache-Control": "public, max-age=600"
        }
      }
    );

    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (e) {
    return Response.json(
      {
        success: false,
        status: e.status || 500,
        errors: e.apiErrors || {},
        error: e.message
      },
      { status: 502, headers: cors }
    );
  }
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
  const cacheKey = new Request(
    `${url.origin}/api/prediction?fixture=${fixture}`
  );

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const data = await apiFetch("/predictions", { fixture }, env);
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
      headers: {
        ...cors,
        "Cache-Control": "public, max-age=3600"
      }
    });

    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (e) {
    return Response.json(
      {
        success: false,
        status: e.status || 500,
        errors: e.apiErrors || {},
        error: e.message
      },
      { status: 502, headers: cors }
    );
  }
}

function completedMatches(list) {
  const completed = new Set(["FT", "AET", "PEN"]);
  return (list || []).filter(m =>
    completed.has(m.fixture?.status?.short) &&
    Number.isFinite(m.goals?.home) &&
    Number.isFinite(m.goals?.away)
  );
}

function teamStats(matches) {
  if (!matches.length) {
    return {
      sample: 0,
      over15: 0,
      over25: 0,
      btts: 0,
      avgGoals: 0
    };
  }

  let o15 = 0;
  let o25 = 0;
  let btts = 0;
  let totalGoals = 0;

  for (const m of matches) {
    const h = Number(m.goals.home);
    const a = Number(m.goals.away);
    const total = h + a;

    totalGoals += total;
    if (total >= 2) o15++;
    if (total >= 3) o25++;
    if (h > 0 && a > 0) btts++;
  }

  return {
    sample: matches.length,
    over15: Math.round((o15 / matches.length) * 100),
    over25: Math.round((o25 / matches.length) * 100),
    btts: Math.round((btts / matches.length) * 100),
    avgGoals: Number((totalGoals / matches.length).toFixed(2))
  };
}

function blend(a, b, key) {
  if (!a.sample && !b.sample) return 0;
  if (!a.sample) return b[key];
  if (!b.sample) return a[key];
  return Math.round((a[key] + b[key]) / 2);
}

function confidence(score, sample) {
  if (sample < 6) return "Düşük";
  if (score >= 72 || score <= 28) return "Yüksek";
  if (score >= 62 || score <= 38) return "Orta";
  return "Düşük";
}

async function model(env, ctx, cors, url) {
  const home = url.searchParams.get("home");
  const away = url.searchParams.get("away");

  if (
    !home || !away ||
    !/^\d+$/.test(home) ||
    !/^\d+$/.test(away)
  ) {
    return Response.json(
      {
        success: false,
        error: "Geçerli home ve away takım ID'leri gerekli."
      },
      { status: 400, headers: cors }
    );
  }

  const cache = caches.default;
  const cacheKey = new Request(
    `${url.origin}/api/model?home=${home}&away=${away}`
  );

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const [homeData, awayData] = await Promise.all([
      apiFetch("/fixtures", { team: home, last: 5 }, env),
      apiFetch("/fixtures", { team: away, last: 5 }, env)
    ]);

    const homeMatches = completedMatches(homeData.response);
    const awayMatches = completedMatches(awayData.response);

    const hs = teamStats(homeMatches);
    const as = teamStats(awayMatches);

    const over15 = blend(hs, as, "over15");
    const over25 = blend(hs, as, "over25");
    const btts = blend(hs, as, "btts");
    const sample = hs.sample + as.sample;

    const avgGoals =
      hs.sample && as.sample
        ? Number(((hs.avgGoals + as.avgGoals) / 2).toFixed(2))
        : hs.sample
          ? hs.avgGoals
          : as.avgGoals;

    const payload = {
      success: true,
      methodology: "Takımların son 5 tamamlanmış maçındaki gol eğilimlerinin ortalaması.",
      sample,
      scores: {
        over15,
        over25,
        btts
      },
      confidence: {
        over15: confidence(over15, sample),
        over25: confidence(over25, sample),
        btts: confidence(btts, sample)
      },
      recent: {
        home: hs,
        away: as
      },
      averageTotalGoals: avgGoals
    };

    const result = Response.json(payload, {
      headers: {
        ...cors,
        "Cache-Control": "public, max-age=21600"
      }
    });

    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (e) {
    return Response.json(
      {
        success: false,
        status: e.status || 500,
        errors: e.apiErrors || {},
        error: e.message
      },
      { status: 502, headers: cors }
    );
  }
}

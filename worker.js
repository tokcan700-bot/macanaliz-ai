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
  const u = new URL(
    "https://v3.football.api-sports.io" + path
  );

  for (const [k, v] of Object.entries(params)) {
    if (
      v !== undefined &&
      v !== null &&
      v !== ""
    ) {
      u.searchParams.set(k, String(v));
    }
  }

  const r = await fetch(u.toString(), {
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY
    }
  });

  const data = await r.json();

  const errors =
    data.errors &&
    typeof data.errors === "object"
      ? Object.keys(data.errors)
      : [];

  if (!r.ok || errors.length) {
    const e = new Error(
      "API Football isteği başarısız."
    );

    e.status = r.status;
    e.apiErrors = data.errors || {};

    throw e;
  }

  return data;
}

function istanbulDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}

async function fixtures(
  env,
  ctx,
  cors,
  url
) {
  const date =
    url.searchParams.get("date") ||
    istanbulDate();

  const cache = caches.default;

  const cacheKey = new Request(
    `${url.origin}/api/fixtures-v4?date=${encodeURIComponent(date)}`
  );

  const hit =
    await cache.match(cacheKey);

  if (hit) {
    return hit;
  }

  try {
    const data = await apiFetch(
      "/fixtures",
      {
        date,
        timezone: "Europe/Istanbul"
      },
      env
    );

    const matches =
      (data.response || []).map(m => ({
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
      {
        success: true,
        date,
        count: matches.length,
        matches
      },
      {
        headers: {
          ...cors,
          "Cache-Control":
            "public, max-age=600"
        }
      }
    );

    ctx.waitUntil(
      cache.put(
        cacheKey,
        result.clone()
      )
    );

    return result;

  } catch (e) {
    return Response.json(
      {
        success: false,
        status: e.status || 500,
        errors: e.apiErrors || {},
        error: e.message
      },
      {
        status: 502,
        headers: cors
      }
    );
  }
}

function numberValue(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function percentValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(
    String(value).replace("%", "")
  );

  return Number.isFinite(n)
    ? n
    : null;
}

function average(values) {
  const valid =
    values.filter(
      v => Number.isFinite(v)
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (a, b) => a + b,
      0
    ) / valid.length
  );
}

function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function poissonOver15(lambda) {
  const p0 =
    Math.exp(-lambda);

  const p1 =
    Math.exp(-lambda) *
    lambda;

  return 1 - p0 - p1;
}

function poissonOver25(lambda) {
  const p0 =
    Math.exp(-lambda);

  const p1 =
    p0 * lambda;

  const p2 =
    p0 *
    Math.pow(lambda, 2) /
    2;

  return 1 - p0 - p1 - p2;
}

function bttsProbability(
  lambdaHome,
  lambdaAway
) {
  return (
    1 -
    Math.exp(-lambdaHome)
  ) * (
    1 -
    Math.exp(-lambdaAway)
  );
}

function buildModel(item) {
  const home =
    item.teams?.home || {};

  const away =
    item.teams?.away || {};

  const comparison =
    item.comparison || {};

  const hLast =
    home.last_5 || {};

  const aLast =
    away.last_5 || {};

  const hScored =
    numberValue(
      hLast.goals?.for?.average
    );

  const hConceded =
    numberValue(
      hLast.goals?.against?.average
    );

  const aScored =
    numberValue(
      aLast.goals?.for?.average
    );

  const aConceded =
    numberValue(
      aLast.goals?.against?.average
    );

  const hLeagueScored =
    numberValue(
      home.league?.goals?.for
        ?.average?.home
    );

  const hLeagueConceded =
    numberValue(
      home.league?.goals?.against
        ?.average?.home
    );

  const aLeagueScored =
    numberValue(
      away.league?.goals?.for
        ?.average?.away
    );

  const aLeagueConceded =
    numberValue(
      away.league?.goals?.against
        ?.average?.away
    );

  const homeAttack =
    average([
      hScored,
      hLeagueScored
    ]) ?? 1.2;

  const homeOpponentDef =
    average([
      aConceded,
      aLeagueConceded
    ]) ?? 1.2;

  const awayAttack =
    average([
      aScored,
      aLeagueScored
    ]) ?? 1.0;

  const awayOpponentDef =
    average([
      hConceded,
      hLeagueConceded
    ]) ?? 1.0;

  let lambdaHome =
    average([
      homeAttack,
      homeOpponentDef
    ]) ?? 1.2;

  let lambdaAway =
    average([
      awayAttack,
      awayOpponentDef
    ]) ?? 1.0;

  const attHome =
    percentValue(
      comparison.att?.home
    );

  const attAway =
    percentValue(
      comparison.att?.away
    );

  const defHome =
    percentValue(
      comparison.def?.home
    );

  const defAway =
    percentValue(
      comparison.def?.away
    );

  if (
    attHome !== null &&
    attAway !== null
  ) {
    const diff =
      (attHome - attAway) / 100;

    lambdaHome *=
      1 + diff * 0.12;

    lambdaAway *=
      1 - diff * 0.12;
  }

  if (
    defHome !== null &&
    defAway !== null
  ) {
    const diff =
      (defHome - defAway) / 100;

    lambdaHome *=
      1 - diff * 0.08;

    lambdaAway *=
      1 + diff * 0.08;
  }

  lambdaHome =
    clamp(
      lambdaHome,
      0.25,
      3.2
    );

  lambdaAway =
    clamp(
      lambdaAway,
      0.25,
      3.2
    );

  const totalLambda =
    lambdaHome +
    lambdaAway;

  let over15 =
    poissonOver15(
      totalLambda
    );

  let over25 =
    poissonOver25(
      totalLambda
    );

  let btts =
    bttsProbability(
      lambdaHome,
      lambdaAway
    );

  const underOver =
    String(
      item.predictions
        ?.under_over || ""
    ).toLowerCase();

  if (
    underOver.includes("+1.5") ||
    underOver.includes("over 1.5")
  ) {
    over15 += 0.04;
  }

  if (
    underOver.includes("+2.5") ||
    underOver.includes("over 2.5")
  ) {
    over25 += 0.04;
  }

  if (
    underOver.includes("-1.5") ||
    underOver.includes("under 1.5")
  ) {
    over15 -= 0.04;
  }

  if (
    underOver.includes("-2.5") ||
    underOver.includes("under 2.5")
  ) {
    over25 -= 0.04;
  }

  over15 =
    clamp(
      over15,
      0.10,
      0.90
    );

  over25 =
    clamp(
      over25,
      0.08,
      0.85
    );

  btts =
    clamp(
      btts,
      0.10,
      0.85
    );

  const recentDataCount =
    [
      hScored,
      hConceded,
      aScored,
      aConceded
    ].filter(
      v => v !== null
    ).length;

  let confidence = "Düşük";

  if (recentDataCount >= 4) {
    confidence = "Orta";
  }

  return {
    over15:
      Math.round(
        over15 * 100
      ),

    over25:
      Math.round(
        over25 * 100
      ),

    btts:
      Math.round(
        btts * 100
      ),

    confidence,

    expectedGoals: {
      home:
        Number(
          lambdaHome.toFixed(2)
        ),

      away:
        Number(
          lambdaAway.toFixed(2)
        ),

      total:
        Number(
          totalLambda.toFixed(2)
        )
    },

    recent: {
      home: {
        scored:
          hScored,

        conceded:
          hConceded
      },

      away: {
        scored:
          aScored,

        conceded:
          aConceded
      }
    },

    basis:
      "Son 5 maç gol ortalamaları, lig iç saha/deplasman gol değerleri ve API karşılaştırma verileri kullanılarak Poisson modeliyle oluşturulmuştur."
  };
}

async function prediction(
  env,
  ctx,
  cors,
  url
) {
  const fixture =
    url.searchParams.get(
      "fixture"
    );

  if (
    !fixture ||
    !/^\d+$/.test(fixture)
  ) {
    return Response.json(
      {
        success: false,
        error:
          "Geçerli fixture ID gerekli."
      },
      {
        status: 400,
        headers: cors
      }
    );
  }

  const cache =
    caches.default;

  const cacheKey =
    new Request(
      `${url.origin}/api/prediction-v4?fixture=${fixture}`
    );

  const hit =
    await cache.match(
      cacheKey
    );

  if (hit) {
    return hit;
  }

  try {
    const data =
      await apiFetch(
        "/predictions",
        { fixture },
        env
      );

    const item =
      data.response?.[0];

    if (!item) {
      return Response.json(
        {
          success: false,
          error:
            "Bu maç için tahmin verisi yok."
        },
        {
          status: 404,
          headers: cors
        }
      );
    }

    const p =
      item.predictions || {};

    const payload = {
      success: true,

      fixture:
        Number(fixture),

      prediction: {
        winner:
          p.winner?.name || null,

        winnerComment:
          p.winner?.comment || null,

        winOrDraw:
          p.win_or_draw ?? null,

        underOver:
          p.under_over || null,

        advice:
          p.advice || null,

        percent: {
          home:
            p.percent?.home || null,

          draw:
            p.percent?.draw || null,

          away:
            p.percent?.away || null
        }
      },

      model:
        buildModel(item)
    };

    const result =
      Response.json(
        payload,
        {
          headers: {
            ...cors,

            "Cache-Control":
              "public, max-age=21600"
          }
        }
      );

    ctx.waitUntil(
      cache.put(
        cacheKey,
        result.clone()
      )
    );

    return result;

  } catch (e) {
    return Response.json(
      {
        success: false,

        status:
          e.status || 500,

        errors:
          e.apiErrors || {},

        error:
          e.message
      },
      {
        status: 502,
        headers: cors
      }
    );
  }
}

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
  const u = new URL("https://v3.football.api-sports.io" + path);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
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

function istanbulDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function fixtures(env, ctx, cors, url) {
  const date =
    url.searchParams.get("date") ||
    istanbulDate();

  const cache = caches.default;

  const cacheKey = new Request(
    `${url.origin}/api/fixtures-v5?date=${encodeURIComponent(date)}`
  );

  const hit = await cache.match(cacheKey);

  if (hit) return hit;

  try {
    const data = await apiFetch(
      "/fixtures",
      {
        date,
        timezone: "Europe/Istanbul"
      },
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
      {
        success: true,
        date,
        count: matches.length,
        matches
      },
      {
        headers: {
          ...cors,
          "Cache-Control": "public, max-age=600"
        }
      }
    );

    ctx.waitUntil(
      cache.put(cacheKey, result.clone())
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
  if (value === null || value === undefined) {
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
  const valid = values.filter(
    v => Number.isFinite(v)
  );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce((a, b) => a + b, 0) /
    valid.length
  );
}

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function shrink(value, target, weight = 0.68) {
  if (!Number.isFinite(value)) {
    return target;
  }

  return (
    value * weight +
    target * (1 - weight)
  );
}

function poissonOver15(lambda) {
  const p0 = Math.exp(-lambda);
  const p1 = p0 * lambda;

  return 1 - p0 - p1;
}

function poissonOver25(lambda) {
  const p0 = Math.exp(-lambda);
  const p1 = p0 * lambda;
  const p2 =
    p0 * Math.pow(lambda, 2) / 2;

  return 1 - p0 - p1 - p2;
}

function bttsProbability(
  lambdaHome,
  lambdaAway
) {
  return (
    1 - Math.exp(-lambdaHome)
  ) * (
    1 - Math.exp(-lambdaAway)
  );
}

function confidenceLabel(score, dataCount) {
  if (dataCount < 4) {
    return "Düşük";
  }

  if (
    score >= 78 ||
    score <= 28
  ) {
    return "Orta";
  }

  if (
    score >= 62 ||
    score <= 38
  ) {
    return "Orta";
  }

  return "Düşük";
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

  const homeAttackRaw =
    average([
      hScored,
      hLeagueScored
    ]);

  const homeDefRaw =
    average([
      aConceded,
      aLeagueConceded
    ]);

  const awayAttackRaw =
    average([
      aScored,
      aLeagueScored
    ]);

  const awayDefRaw =
    average([
      hConceded,
      hLeagueConceded
    ]);

  let lambdaHome =
    average([
      shrink(
        homeAttackRaw,
        1.35
      ),
      shrink(
        homeDefRaw,
        1.20
      )
    ]) ?? 1.30;

  let lambdaAway =
    average([
      shrink(
        awayAttackRaw,
        1.10
      ),
      shrink(
        awayDefRaw,
        1.15
      )
    ]) ?? 1.10;

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
      clamp(
        (attHome - attAway) / 100,
        -0.6,
        0.6
      );

    lambdaHome *=
      1 + diff * 0.07;

    lambdaAway *=
      1 - diff * 0.07;
  }

  if (
    defHome !== null &&
    defAway !== null
  ) {
    const diff =
      clamp(
        (defHome - defAway) / 100,
        -0.6,
        0.6
      );

    lambdaHome *=
      1 - diff * 0.05;

    lambdaAway *=
      1 + diff * 0.05;
  }

  lambdaHome =
    clamp(
      lambdaHome,
      0.35,
      2.35
    );

  lambdaAway =
    clamp(
      lambdaAway,
      0.30,
      2.15
    );

  let totalLambda =
    lambdaHome +
    lambdaAway;

  totalLambda =
    clamp(
      totalLambda,
      0.80,
      4.00
    );

  const split =
    lambdaHome /
    (
      lambdaHome +
      lambdaAway
    );

  lambdaHome =
    totalLambda * split;

  lambdaAway =
    totalLambda *
    (1 - split);

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
      item.predictions?.under_over || ""
    ).toLowerCase();

  const advice =
    String(
      item.predictions?.advice || ""
    ).toLowerCase();

  if (
    underOver.includes("+1.5") ||
    underOver.includes("over 1.5") ||
    advice.includes("+1.5") ||
    advice.includes("over 1.5")
  ) {
    over15 += 0.025;
  }

  if (
    underOver.includes("+2.5") ||
    underOver.includes("over 2.5") ||
    advice.includes("+2.5") ||
    advice.includes("over 2.5")
  ) {
    over25 += 0.03;
  }

  if (
    underOver.includes("-1.5") ||
    underOver.includes("under 1.5")
  ) {
    over15 -= 0.03;
  }

  if (
    underOver.includes("-2.5") ||
    underOver.includes("under 2.5")
  ) {
    over25 -= 0.03;
  }

  over15 =
    clamp(
      over15,
      0.18,
      0.88
    );

  over25 =
    clamp(
      over25,
      0.12,
      0.78
    );

  btts =
    clamp(
      btts,
      0.15,
      0.75
    );

  const over15Pct =
    Math.round(
      over15 * 100
    );

  const over25Pct =
    Math.round(
      over25 * 100
    );

  const bttsPct =
    Math.round(
      btts * 100
    );

  const recentDataCount =
    [
      hScored,
      hConceded,
      aScored,
      aConceded,
      hLeagueScored,
      hLeagueConceded,
      aLeagueScored,
      aLeagueConceded
    ].filter(
      v => v !== null
    ).length;

  return {
    over15:
      over15Pct,

    over25:
      over25Pct,

    btts:
      bttsPct,

    confidence: {
      over15:
        confidenceLabel(
          over15Pct,
          recentDataCount
        ),

      over25:
        confidenceLabel(
          over25Pct,
          recentDataCount
        ),

      btts:
        confidenceLabel(
          bttsPct,
          recentDataCount
        )
    },

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

    dataCount:
      recentDataCount,

    basis:
      "Son maç ve lig gol ortalamaları ortalamaya doğru dengelenmiş, aşırı uç değerler sınırlandırılmış ve Poisson modeliyle hesaplanmıştır."
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
      `${url.origin}/api/prediction-v5?fixture=${fixture}`
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

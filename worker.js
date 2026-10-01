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
        {
          success: false,
          error: "API_FOOTBALL_KEY bulunamadı."
        },
        {
          status: 500,
          headers: cors
        }
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
      {
        success: false,
        error: "Endpoint bulunamadı."
      },
      {
        status: 404,
        headers: cors
      }
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

  const r = await fetch(
    u.toString(),
    {
      headers: {
        "x-apisports-key":
          env.API_FOOTBALL_KEY
      }
    }
  );

  const data = await r.json();

  const errors =
    data.errors &&
    typeof data.errors === "object"
      ? Object.keys(data.errors)
      : [];

  if (!r.ok || errors.length) {
    const e =
      new Error(
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

  const cacheKey =
    new Request(
      `${url.origin}/api/fixtures-v3?date=${encodeURIComponent(date)}`
    );

  const hit =
    await cache.match(cacheKey);

  if (hit) {
    return hit;
  }

  try {
    const data =
      await apiFetch(
        "/fixtures",
        {
          date,
          timezone:
            "Europe/Istanbul"
        },
        env
      );

    const matches =
      (data.response || [])
      .map(m => ({
        id: m.fixture.id,

        kickoff:
          m.fixture.date,

        status:
          m.fixture.status.short,

        league: {
          id:
            m.league.id,

          name:
            m.league.name,

          country:
            m.league.country,

          logo:
            m.league.logo
        },

        home: {
          id:
            m.teams.home.id,

          name:
            m.teams.home.name,

          logo:
            m.teams.home.logo
        },

        away: {
          id:
            m.teams.away.id,

          name:
            m.teams.away.name,

          logo:
            m.teams.away.logo
        },

        score: {
          home:
            m.goals.home,

          away:
            m.goals.away
        }
      }));

    const result =
      Response.json(
        {
          success: true,
          date,
          count:
            matches.length,
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

function parseGoalRange(value) {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const nums =
    value.match(
      /\d+(?:\.\d+)?/g
    );

  if (
    !nums ||
    nums.length === 0
  ) {
    return null;
  }

  if (nums.length === 1) {
    return Number(nums[0]);
  }

  return (
    Number(nums[0]) +
    Number(nums[1])
  ) / 2;
}

function clamp(
  n,
  min = 5,
  max = 95
) {
  return Math.max(
    min,
    Math.min(
      max,
      Math.round(n)
    )
  );
}

function heuristicModel(
  predictions
) {
  const goalsHome =
    parseGoalRange(
      predictions.goals?.home
    );

  const goalsAway =
    parseGoalRange(
      predictions.goals?.away
    );

  const expectedTotal =
    goalsHome !== null &&
    goalsAway !== null
      ? goalsHome + goalsAway
      : null;

  let over15 = 58;
  let over25 = 48;
  let btts = 47;

  if (
    expectedTotal !== null
  ) {
    over15 =
      42 +
      expectedTotal * 16;

    over25 =
      26 +
      expectedTotal * 15;

    if (
      goalsHome > 0.7 &&
      goalsAway > 0.7
    ) {
      btts =
        45 +
        Math.min(
          goalsHome,
          goalsAway
        ) * 22;
    } else {
      btts =
        32 +
        Math.min(
          goalsHome || 0,
          goalsAway || 0
        ) * 18;
    }
  }

  const uo =
    String(
      predictions.under_over || ""
    ).toLowerCase();

  if (
    uo.includes("+1.5") ||
    uo.includes("over 1.5")
  ) {
    over15 += 12;
  }

  if (
    uo.includes("+2.5") ||
    uo.includes("over 2.5")
  ) {
    over25 += 14;
    over15 += 5;
  }

  if (
    uo.includes("-2.5") ||
    uo.includes("under 2.5")
  ) {
    over25 -= 18;
  }

  if (
    uo.includes("-1.5") ||
    uo.includes("under 1.5")
  ) {
    over15 -= 18;
  }

  const advice =
    String(
      predictions.advice || ""
    ).toLowerCase();

  if (
    advice.includes("+1.5") ||
    advice.includes("over 1.5")
  ) {
    over15 += 8;
  }

  if (
    advice.includes("+2.5") ||
    advice.includes("over 2.5")
  ) {
    over25 += 10;
  }

  const homePct =
    Number(
      String(
        predictions.percent?.home || ""
      ).replace("%", "")
    ) || 0;

  const drawPct =
    Number(
      String(
        predictions.percent?.draw || ""
      ).replace("%", "")
    ) || 0;

  const awayPct =
    Number(
      String(
        predictions.percent?.away || ""
      ).replace("%", "")
    ) || 0;

  const dominance =
    Math.abs(
      homePct - awayPct
    );

  if (dominance >= 45) {
    btts -= 8;
  }

  if (drawPct >= 35) {
    btts += 5;
  }

  over15 =
    clamp(over15);

  over25 =
    clamp(over25);

  btts =
    clamp(btts);

  return {
    over15,
    over25,
    btts,

    confidence:
      expectedTotal !== null
        ? "Orta"
        : "Düşük",

    basis:
      "API-Football tahmin verisinden türetilen heuristik skor. Ek takım geçmişi API isteği yapmaz.",

    expectedTotalGoals:
      expectedTotal !== null
        ? Number(
            expectedTotal.toFixed(2)
          )
        : null
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
      `${url.origin}/api/prediction-v3?fixture=${fixture}`
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
        {
          fixture
        },
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

        goals: {
          home:
            p.goals?.home ?? null,

          away:
            p.goals?.away ?? null
        },

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
        heuristicModel(p)
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

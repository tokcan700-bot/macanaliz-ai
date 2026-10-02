export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: cors
      });
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
      return fixtures(
        env,
        ctx,
        cors,
        url
      );
    }

    if (url.pathname === "/api/prediction") {
      return prediction(
        env,
        ctx,
        cors,
        url
      );
    }

    if (url.pathname === "/api/live-detail") {
      return liveDetail(
        env,
        ctx,
        cors,
        url
      );
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(
        request
      );
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


async function apiFetch(
  path,
  params,
  env
) {
  const u =
    new URL(
      "https://v3.football.api-sports.io" +
      path
    );

  for (
    const [key, value]
    of Object.entries(params || {})
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      u.searchParams.set(
        key,
        String(value)
      );
    }
  }

  const response =
    await fetch(
      u.toString(),
      {
        headers: {
          "x-apisports-key":
            env.API_FOOTBALL_KEY
        }
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch (e) {
    const error =
      new Error(
        "API Football JSON cevabı alınamadı."
      );

    error.status =
      response.status;

    throw error;
  }

  let hasErrors =
    false;

  if (data?.errors) {
    if (
      Array.isArray(data.errors)
    ) {
      hasErrors =
        data.errors.length > 0;
    } else if (
      typeof data.errors === "object"
    ) {
      hasErrors =
        Object.keys(
          data.errors
        ).length > 0;
    } else if (
      String(data.errors).trim()
    ) {
      hasErrors =
        true;
    }
  }

  if (
    !response.ok ||
    hasErrors
  ) {
    const error =
      new Error(
        "API Football isteği başarısız."
      );

    error.status =
      response.status;

    error.apiErrors =
      data?.errors || {};

    throw error;
  }

  return data;
}


async function playerEloFetch(
  fixture,
  env
) {
  if (!env.PLAYERELO_KEY) {
    return {
      available: false,
      reason:
        "PLAYERELO_KEY bulunamadı."
    };
  }

  try {
    const response =
      await fetch(
        `https://data-api.playerelo.football/v1/fixtures/${fixture}/prediction`,
        {
          headers: {
            "Authorization":
              `Bearer ${env.PLAYERELO_KEY}`
          }
        }
      );

    if (!response.ok) {
      return {
        available: false,
        status:
          response.status,
        reason:
          "PlayerElo verisi alınamadı."
      };
    }

    const data =
      await response.json();

    return {
      available: true,
      data
    };

  } catch (e) {
    return {
      available: false,
      reason:
        "PlayerElo bağlantı hatası."
    };
  }
}


function istanbulDate() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Europe/Istanbul",
      year:
        "numeric",
      month:
        "2-digit",
      day:
        "2-digit"
    }
  ).format(
    new Date()
  );
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

  const cache =
    caches.default;

  const cacheKey =
    new Request(
      `${url.origin}/api/fixtures-v8?date=${encodeURIComponent(date)}`
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
      .map(
        item => ({
          id:
            item.fixture?.id,

          kickoff:
            item.fixture?.date,

          status:
            item.fixture
              ?.status
              ?.short,

          statusLong:
            item.fixture
              ?.status
              ?.long,

          elapsed:
            item.fixture
              ?.status
              ?.elapsed,

          extra:
            item.fixture
              ?.status
              ?.extra,

          league: {
            id:
              item.league?.id,

            name:
              item.league?.name,

            country:
              item.league?.country,

            logo:
              item.league?.logo
          },

          home: {
            id:
              item.teams
                ?.home
                ?.id,

            name:
              item.teams
                ?.home
                ?.name,

            logo:
              item.teams
                ?.home
                ?.logo
          },

          away: {
            id:
              item.teams
                ?.away
                ?.id,

            name:
              item.teams
                ?.away
                ?.name,

            logo:
              item.teams
                ?.away
                ?.logo
          },

          score: {
            home:
              item.goals
                ?.home ??
              null,

            away:
              item.goals
                ?.away ??
              null
          }
        })
      );

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
              "public, max-age=60"
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


function numberValue(value) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function percentValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(
      String(value)
        .replace("%", "")
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function average(values) {
  const valid =
    values.filter(
      value =>
        Number.isFinite(
          value
        )
    );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (total, value) =>
        total + value,
      0
    ) /
    valid.length
  );
}


function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function shrink(
  value,
  target,
  weight = 0.68
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return target;
  }

  return (
    value * weight +
    target *
    (1 - weight)
  );
}


function poissonOver15(
  lambda
) {
  const p0 =
    Math.exp(
      -lambda
    );

  const p1 =
    p0 * lambda;

  return (
    1 -
    p0 -
    p1
  );
}


function poissonOver25(
  lambda
) {
  const p0 =
    Math.exp(
      -lambda
    );

  const p1 =
    p0 * lambda;

  const p2 =
    p0 *
    Math.pow(
      lambda,
      2
    ) /
    2;

  return (
    1 -
    p0 -
    p1 -
    p2
  );
}


function bttsProbability(
  lambdaHome,
  lambdaAway
) {
  return (
    1 -
    Math.exp(
      -lambdaHome
    )
  ) * (
    1 -
    Math.exp(
      -lambdaAway
    )
  );
}


function confidenceLabel(
  score,
  dataCount
) {
  if (
    dataCount < 4
  ) {
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
    item.teams?.home ||
    {};

  const away =
    item.teams?.away ||
    {};

  const comparison =
    item.comparison ||
    {};

  const homeLast =
    home.last_5 ||
    {};

  const awayLast =
    away.last_5 ||
    {};

  const hScored =
    numberValue(
      homeLast
        .goals
        ?.for
        ?.average
    );

  const hConceded =
    numberValue(
      homeLast
        .goals
        ?.against
        ?.average
    );

  const aScored =
    numberValue(
      awayLast
        .goals
        ?.for
        ?.average
    );

  const aConceded =
    numberValue(
      awayLast
        .goals
        ?.against
        ?.average
    );

  const hLeagueScored =
    numberValue(
      home.league
        ?.goals
        ?.for
        ?.average
        ?.home
    );

  const hLeagueConceded =
    numberValue(
      home.league
        ?.goals
        ?.against
        ?.average
        ?.home
    );

  const aLeagueScored =
    numberValue(
      away.league
        ?.goals
        ?.for
        ?.average
        ?.away
    );

  const aLeagueConceded =
    numberValue(
      away.league
        ?.goals
        ?.against
        ?.average
        ?.away
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
      comparison
        .att
        ?.home
    );

  const attAway =
    percentValue(
      comparison
        .att
        ?.away
    );

  const defHome =
    percentValue(
      comparison
        .def
        ?.home
    );

  const defAway =
    percentValue(
      comparison
        .def
        ?.away
    );

  if (
    attHome !== null &&
    attAway !== null
  ) {
    const diff =
      clamp(
        (
          attHome -
          attAway
        ) / 100,
        -0.6,
        0.6
      );

    lambdaHome *=
      1 +
      diff *
      0.07;

    lambdaAway *=
      1 -
      diff *
      0.07;
  }

  if (
    defHome !== null &&
    defAway !== null
  ) {
    const diff =
      clamp(
        (
          defHome -
          defAway
        ) / 100,
        -0.6,
        0.6
      );

    lambdaHome *=
      1 -
      diff *
      0.05;

    lambdaAway *=
      1 +
      diff *
      0.05;
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
    totalLambda *
    split;

  lambdaAway =
    totalLambda *
    (
      1 -
      split
    );

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
        ?.under_over ||
      ""
    ).toLowerCase();

  const advice =
    String(
      item.predictions
        ?.advice ||
      ""
    ).toLowerCase();

  if (
    underOver.includes(
      "+1.5"
    ) ||
    underOver.includes(
      "over 1.5"
    ) ||
    advice.includes(
      "+1.5"
    ) ||
    advice.includes(
      "over 1.5"
    )
  ) {
    over15 +=
      0.025;
  }

  if (
    underOver.includes(
      "+2.5"
    ) ||
    underOver.includes(
      "over 2.5"
    ) ||
    advice.includes(
      "+2.5"
    ) ||
    advice.includes(
      "over 2.5"
    )
  ) {
    over25 +=
      0.03;
  }

  if (
    underOver.includes(
      "-1.5"
    ) ||
    underOver.includes(
      "under 1.5"
    )
  ) {
    over15 -=
      0.03;
  }

  if (
    underOver.includes(
      "-2.5"
    ) ||
    underOver.includes(
      "under 2.5"
    )
  ) {
    over25 -=
      0.03;
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

  const dataCount =
    [
      hScored,
      hConceded,
      aScored,
      aConceded,
      hLeagueScored,
      hLeagueConceded,
      aLeagueScored,
      aLeagueConceded
    ]
    .filter(
      value =>
        value !== null
    )
    .length;

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
          dataCount
        ),

      over25:
        confidenceLabel(
          over25Pct,
          dataCount
        ),

      btts:
        confidenceLabel(
          bttsPct,
          dataCount
        )
    },

    expectedGoals: {
      home:
        Number(
          lambdaHome
            .toFixed(2)
        ),

      away:
        Number(
          lambdaAway
            .toFixed(2)
        ),

      total:
        Number(
          totalLambda
            .toFixed(2)
        )
    },

    dataCount
  };
}


function probabilityPercent(value) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return null;
  }

  if (
    number <= 1
  ) {
    return Math.round(
      number * 100
    );
  }

  return Math.round(
    number
  );
}


function buildPlayerEloModel(
  data
) {
  if (!data) {
    return null;
  }

  const scorelines =
    data.scoreline_distribution ||
    {};

  let mass =
    0;

  let over15 =
    0;

  let over25 =
    0;

  let btts =
    0;

  for (
    const [
      score,
      rawProbability
    ]
    of Object.entries(
      scorelines
    )
  ) {
    const parts =
      score.split("-");

    if (
      parts.length !== 2
    ) {
      continue;
    }

    const homeGoals =
      Number(
        parts[0]
      );

    const awayGoals =
      Number(
        parts[1]
      );

    const probability =
      Number(
        rawProbability
      );

    if (
      !Number.isFinite(
        homeGoals
      ) ||
      !Number.isFinite(
        awayGoals
      ) ||
      !Number.isFinite(
        probability
      ) ||
      probability < 0
    ) {
      continue;
    }

    mass +=
      probability;

    const total =
      homeGoals +
      awayGoals;

    if (
      total >= 2
    ) {
      over15 +=
        probability;
    }

    if (
      total >= 3
    ) {
      over25 +=
        probability;
    }

    if (
      homeGoals > 0 &&
      awayGoals > 0
    ) {
      btts +=
        probability;
    }
  }

  const result = {
    available: true,

    home:
      probabilityPercent(
        data.p_home
      ),

    draw:
      probabilityPercent(
        data.p_draw
      ),

    away:
      probabilityPercent(
        data.p_away
      ),

    homeElo:
      numberValue(
        data.home_team_elo
      ),

    awayElo:
      numberValue(
        data.away_team_elo
      )
  };

  if (
    mass <= 0
  ) {
    return {
      ...result,
      over15:
        null,
      over25:
        null,
      btts:
        null
    };
  }

  return {
    ...result,

    over15:
      Math.round(
        (
          over15 /
          mass
        ) *
        100
      ),

    over25:
      Math.round(
        (
          over25 /
          mass
        ) *
        100
      ),

    btts:
      Math.round(
        (
          btts /
          mass
        ) *
        100
      )
  };
}


function numericAverage(values) {
  const valid =
    values.filter(
      value =>
        Number.isFinite(
          value
        )
    );

  if (
    !valid.length
  ) {
    return null;
  }

  return Math.round(
    valid.reduce(
      (total, value) =>
        total + value,
      0
    ) /
    valid.length
  );
}


function buildConsensus(
  apiPrediction,
  model,
  playerElo
) {
  const apiHome =
    percentValue(
      apiPrediction
        ?.percent
        ?.home
    );

  const apiDraw =
    percentValue(
      apiPrediction
        ?.percent
        ?.draw
    );

  const apiAway =
    percentValue(
      apiPrediction
        ?.percent
        ?.away
    );

  return {
    home:
      numericAverage([
        apiHome,
        playerElo?.home
      ]),

    draw:
      numericAverage([
        apiDraw,
        playerElo?.draw
      ]),

    away:
      numericAverage([
        apiAway,
        playerElo?.away
      ]),

    over15:
      numericAverage([
        model?.over15,
        playerElo?.over15
      ]),

    over25:
      numericAverage([
        model?.over25,
        playerElo?.over25
      ]),

    btts:
      numericAverage([
        model?.btts,
        playerElo?.btts
      ]),

    sources: {
      goals:
        Number.isFinite(
          playerElo?.over15
        )
          ? 2
          : 1,

      result:
        Number.isFinite(
          playerElo?.home
        )
          ? 2
          : 1
    }
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
    !/^\d+$/.test(
      fixture
    )
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
      `${url.origin}/api/prediction-v8?fixture=${fixture}`
    );

  const hit =
    await cache.match(
      cacheKey
    );

  if (hit) {
    return hit;
  }

  try {
    const [
      apiResult,
      playerEloResult
    ] =
      await Promise.allSettled([
        apiFetch(
          "/predictions",
          {
            fixture
          },
          env
        ),

        playerEloFetch(
          fixture,
          env
        )
      ]);

    if (
      apiResult.status !==
      "fulfilled"
    ) {
      throw apiResult.reason;
    }

    const data =
      apiResult.value;

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

    const predictions =
      item.predictions ||
      {};

    const apiPrediction = {
      winner:
        predictions
          .winner
          ?.name ||
        null,

      winnerComment:
        predictions
          .winner
          ?.comment ||
        null,

      winOrDraw:
        predictions
          .win_or_draw ??
        null,

      underOver:
        predictions
          .under_over ||
        null,

      advice:
        predictions
          .advice ||
        null,

      percent: {
        home:
          predictions
            .percent
            ?.home ||
          null,

        draw:
          predictions
            .percent
            ?.draw ||
          null,

        away:
          predictions
            .percent
            ?.away ||
          null
      }
    };

    const model =
      buildModel(
        item
      );

    let playerElo = {
      available:
        false
    };

    if (
      playerEloResult.status ===
      "fulfilled" &&
      playerEloResult
        .value
        ?.available
    ) {
      playerElo =
        buildPlayerEloModel(
          playerEloResult
            .value
            .data
        ) || {
          available:
            false
        };
    }

    const consensus =
      buildConsensus(
        apiPrediction,
        model,
        playerElo
      );

    const payload = {
      success: true,

      fixture:
        Number(fixture),

      prediction:
        apiPrediction,

      model,

      playerElo,

      consensus,

      sources: {
        apiFootball:
          true,

        macAnalizModel:
          true,

        playerElo:
          Boolean(
            playerElo
              .available
          )
      }
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
          e.status ||
          500,
        errors:
          e.apiErrors ||
          {},
        error:
          e.message ||
          "Tahmin verisi alınamadı."
      },
      {
        status: 502,
        headers: cors
      }
    );
  }
}


function findStat(
  statistics,
  type
) {
  const found =
    (statistics || [])
    .find(
      item =>
        String(
          item.type ||
          ""
        )
        .toLowerCase() ===
        String(type)
        .toLowerCase()
    );

  return found
    ? found.value ?? null
    : null;
}


function normalizeStatsTeam(
  block
) {
  if (!block) {
    return null;
  }

  const statistics =
    block.statistics ||
    [];

  return {
    team: {
      id:
        block.team
          ?.id ||
        null,

      name:
        block.team
          ?.name ||
        null,

      logo:
        block.team
          ?.logo ||
        null
    },

    shotsOnGoal:
      findStat(
        statistics,
        "Shots on Goal"
      ),

    shotsOffGoal:
      findStat(
        statistics,
        "Shots off Goal"
      ),

    totalShots:
      findStat(
        statistics,
        "Total Shots"
      ),

    blockedShots:
      findStat(
        statistics,
        "Blocked Shots"
      ),

    shotsInsideBox:
      findStat(
        statistics,
        "Shots insidebox"
      ),

    shotsOutsideBox:
      findStat(
        statistics,
        "Shots outsidebox"
      ),

    fouls:
      findStat(
        statistics,
        "Fouls"
      ),

    corners:
      findStat(
        statistics,
        "Corner Kicks"
      ),

    offsides:
      findStat(
        statistics,
        "Offsides"
      ),

    possession:
      findStat(
        statistics,
        "Ball Possession"
      ),

    yellowCards:
      findStat(
        statistics,
        "Yellow Cards"
      ),

    redCards:
      findStat(
        statistics,
        "Red Cards"
      ),

    saves:
      findStat(
        statistics,
        "Goalkeeper Saves"
      ),

    totalPasses:
      findStat(
        statistics,
        "Total passes"
      ),

    accuratePasses:
      findStat(
        statistics,
        "Passes accurate"
      ),

    passAccuracy:
      findStat(
        statistics,
        "Passes %"
      )
  };
}


function normalizeEvent(event) {
  return {
    elapsed:
      event.time
        ?.elapsed ??
      null,

    extra:
      event.time
        ?.extra ??
      null,

    team: {
      id:
        event.team
          ?.id ||
        null,

      name:
        event.team
          ?.name ||
        null,

      logo:
        event.team
          ?.logo ||
        null
    },

    player:
      event.player
        ?.name ||
      null,

    assist:
      event.assist
        ?.name ||
      null,

    type:
      event.type ||
      null,

    detail:
      event.detail ||
      null,

    comments:
      event.comments ||
      null
  };
}


function settledError(result) {
  if (
    !result ||
    result.status !==
    "rejected"
  ) {
    return null;
  }

  const reason =
    result.reason ||
    {};

  return {
    message:
      reason.message ||
      "İstek başarısız.",

    status:
      reason.status ||
      null,

    errors:
      reason.apiErrors ||
      {}
  };
}


async function liveDetail(
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
    !/^\d+$/.test(
      fixture
    )
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
      `${url.origin}/api/live-detail-v2?fixture=${fixture}`
    );

  const hit =
    await cache.match(
      cacheKey
    );

  if (hit) {
    return hit;
  }

  const [
    fixtureResult,
    statisticsResult,
    eventsResult
  ] =
    await Promise.allSettled([
      apiFetch(
        "/fixtures",
        {
          id:
            fixture,
          timezone:
            "Europe/Istanbul"
        },
        env
      ),

      apiFetch(
        "/fixtures/statistics",
        {
          fixture
        },
        env
      ),

      apiFetch(
        "/fixtures/events",
        {
          fixture
        },
        env
      )
    ]);

  if (
    fixtureResult.status !==
    "fulfilled"
  ) {
    const error =
      fixtureResult.reason ||
      {};

    return Response.json(
      {
        success: false,

        error:
          error.message ||
          "Maç bilgisi alınamadı.",

        status:
          error.status ||
          500,

        errors:
          error.apiErrors ||
          {}
      },
      {
        status: 502,
        headers: cors
      }
    );
  }

  const fixtureData =
    fixtureResult.value;

  const item =
    fixtureData
      .response
      ?.[0];

  if (!item) {
    return Response.json(
      {
        success: false,
        error:
          "Maç bulunamadı."
      },
      {
        status: 404,
        headers: cors
      }
    );
  }

  let statsResponse =
    [];

  if (
    statisticsResult.status ===
    "fulfilled"
  ) {
    statsResponse =
      statisticsResult
        .value
        ?.response ||
      [];
  }

  let eventsResponse =
    [];

  if (
    eventsResult.status ===
    "fulfilled"
  ) {
    eventsResponse =
      eventsResult
        .value
        ?.response ||
      [];
  }

  const homeTeamId =
    item.teams
      ?.home
      ?.id;

  const awayTeamId =
    item.teams
      ?.away
      ?.id;

  const homeStatsBlock =
    statsResponse.find(
      block =>
        Number(
          block.team?.id
        ) ===
        Number(
          homeTeamId
        )
    ) ||
    statsResponse[0] ||
    null;

  const awayStatsBlock =
    statsResponse.find(
      block =>
        Number(
          block.team?.id
        ) ===
        Number(
          awayTeamId
        )
    ) ||
    statsResponse[1] ||
    null;

  const homeStats =
    normalizeStatsTeam(
      homeStatsBlock
    );

  const awayStats =
    normalizeStatsTeam(
      awayStatsBlock
    );

  const events =
    eventsResponse.map(
      normalizeEvent
    );

  const payload = {
    success: true,

    fixture: {
      id:
        item.fixture
          ?.id ||
        Number(fixture),

      date:
        item.fixture
          ?.date ||
        null,

      referee:
        item.fixture
          ?.referee ||
        null,

      venue: {
        name:
          item.fixture
            ?.venue
            ?.name ||
          null,

        city:
          item.fixture
            ?.venue
            ?.city ||
          null
      },

      status: {
        long:
          item.fixture
            ?.status
            ?.long ||
          null,

        short:
          item.fixture
            ?.status
            ?.short ||
          null,

        elapsed:
          item.fixture
            ?.status
            ?.elapsed ??
          null,

        extra:
          item.fixture
            ?.status
            ?.extra ??
          null
      }
    },

    league: {
      id:
        item.league
          ?.id ||
        null,

      name:
        item.league
          ?.name ||
        null,

      country:
        item.league
          ?.country ||
        null,

      logo:
        item.league
          ?.logo ||
        null,

      round:
        item.league
          ?.round ||
        null
    },

    teams: {
      home: {
        id:
          homeTeamId ||
        null,

        name:
          item.teams
            ?.home
            ?.name ||
        null,

        logo:
          item.teams
            ?.home
            ?.logo ||
        null
      },

      away: {
        id:
          awayTeamId ||
        null,

        name:
          item.teams
            ?.away
            ?.name ||
        null,

        logo:
          item.teams
            ?.away
            ?.logo ||
        null
      }
    },

    goals: {
      home:
        item.goals
          ?.home ??
        null,

      away:
        item.goals
          ?.away ??
        null
    },

    score:
      item.score ||
      {},

    statistics: {
      available:
        Boolean(
          homeStats ||
          awayStats
        ),

      home:
        homeStats,

      away:
        awayStats
    },

    events: {
      available:
        events.length > 0,

      count:
        events.length,

      items:
        events
    },

    availability: {
      fixture:
        true,

      statistics:
        statisticsResult.status ===
        "fulfilled" &&
        statsResponse.length > 0,

      events:
        eventsResult.status ===
        "fulfilled" &&
        eventsResponse.length > 0
    },

    debug: {
      statisticsError:
        settledError(
          statisticsResult
        ),

      eventsError:
        settledError(
          eventsResult
        )
    }
  };

  const result =
    Response.json(
      payload,
      {
        headers: {
          ...cors,

          "Cache-Control":
            "public, max-age=30"
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
}

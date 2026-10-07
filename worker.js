// MaçAnaliz API - Worker v3
// Cloudflare Workers
// Bindings:
// API_FOOTBALL_KEY
// FOOTBALL_DATA_KEY (opsiyonel)
// ASSETS (opsiyonel)

const TZ = "Europe/Istanbul";
const API_BASE = "https://v3.football.api-sports.io";
const SPORTSDB_BASE =
  "https://www.thesportsdb.com/api/v1/json/123";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=UTF-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      // =========================
      // HEALTH
      // =========================

      if (
        url.pathname === "/health" ||
        url.pathname === "/api/health"
      ) {
        return json(
          {
            success: true,
            service: "macanaliz-api",
            version: "3.0",
            timezone: TZ
          },
          200,
          cors
        );
      }

      // =========================
      // MAÇLAR
      // =========================

      if (
        url.pathname === "/api/fixtures" ||
        url.pathname === "/fixtures"
      ) {
        return fixtures(env, ctx, cors, url);
      }

      if (url.pathname === "/api/live") {
        return live(env, ctx, cors, url);
      }

      if (
        url.pathname === "/api/fixture" ||
        url.pathname === "/api/match"
      ) {
        return fixtureDetail(env, ctx, cors, url);
      }

      if (url.pathname === "/api/live-detail") {
        return liveDetail(env, ctx, cors, url);
      }

      // =========================
      // TAHMİN
      // =========================

      if (url.pathname === "/api/prediction") {
        return prediction(env, ctx, cors, url);
      }

      if (url.pathname === "/api/model") {
        return model(env, ctx, cors, url);
      }

      // =========================
      // TAKIM
      // =========================

      if (url.pathname === "/api/team-search") {
        return teamSearch(env, ctx, cors, url);
      }

      if (url.pathname === "/api/team") {
        return teamInfo(env, ctx, cors, url);
      }

      if (url.pathname === "/api/team-form") {
        return teamForm(env, ctx, cors, url);
      }

      if (url.pathname === "/api/squad") {
        return squad(env, ctx, cors, url);
      }

      // =========================
      // LİGLER
      // =========================

      if (
  url.pathname === "/api/standings" ||
  url.pathname === "/api/api-football-standings"
) {
  return standings(env, ctx, cors, url);
}

      if (url.pathname === "/api/leagues") {
        return leagues(env, ctx, cors, url);
      }

      // =========================
      // THE SPORTS DB
      // =========================

      if (url.pathname === "/api/sportsdb-search") {
        return sportsDbTeamSearch(ctx, cors, url);
      }

      if (url.pathname === "/api/sportsdb-last") {
        return sportsDbLastEvents(ctx, cors, url);
      }

      // =========================
      // FRONTEND ASSETS
      // =========================

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json(
        {
          success: false,
          error: "Endpoint bulunamadı."
        },
        404,
        cors
      );
    } catch (e) {
      return json(
        {
          success: false,
          error: e?.message || "Sunucu hatası.",
          status: e?.status || 500,
          details: e?.apiErrors || null
        },
        e?.status && e.status < 500
          ? e.status
          : 502,
        cors
      );
    }
  }
};

// ==========================================
// YARDIMCI FONKSİYONLAR
// ==========================================

function json(
  data,
  status,
  headers,
  maxAge
) {
  const h = { ...headers };

  if (maxAge !== undefined) {
    h["Cache-Control"] =
      `public, max-age=${maxAge}`;
  }

  return Response.json(data, {
    status,
    headers: h
  });
}

function param(url, name) {
  return (
    url.searchParams.get(name) || ""
  ).trim();
}

function numeric(value) {
  return /^\d+$/.test(value || "");
}

function todayTR() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());
}

function apiErrors(data) {
  if (!data?.errors) return [];

  if (Array.isArray(data.errors)) {
    return data.errors;
  }

  if (
    typeof data.errors === "object"
  ) {
    return Object.keys(data.errors);
  }

  return [String(data.errors)];
}

// ==========================================
// API FOOTBALL
// ==========================================

async function apiFetch(
  path,
  params,
  env
) {
  if (!env.API_FOOTBALL_KEY) {
    const error =
      new Error(
        "API_FOOTBALL_KEY bulunamadı."
      );

    error.status = 500;

    throw error;
  }

  const apiUrl =
    new URL(API_BASE + path);

  for (
    const [key, value]
    of Object.entries(params || {})
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      apiUrl.searchParams.set(
        key,
        String(value)
      );
    }
  }

  const response = await fetch(
    apiUrl.toString(),
    {
      headers: {
        "x-apisports-key":
          env.API_FOOTBALL_KEY
      }
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  const errors = apiErrors(data);

  if (
    !response.ok ||
    errors.length
  ) {
    const error =
      new Error(
        "API-Football isteği başarısız."
      );

    error.status =
      response.status || 502;

    error.apiErrors =
      data.errors || {};

    throw error;
  }

  return data;
}

// ==========================================
// CACHE
// ==========================================

async function cached(
  ctx,
  key,
  seconds,
  callback
) {
  const cache =
    caches.default;

  const request =
    new Request(key);

  const hit =
    await cache.match(request);

  if (hit) {
    return hit;
  }

  const response =
    await callback();

  if (
    response.ok &&
    seconds > 0
  ) {
    ctx.waitUntil(
      cache.put(
        request,
        response.clone()
      )
    );
  }

  return response;
}

// ==========================================
// MAÇ VERİSİ DÖNÜŞTÜRME
// ==========================================

function mapFixture(match) {
  return {
    id:
      match.fixture?.id ??
      null,

    kickoff:
      match.fixture?.date ??
      null,

    date:
      match.fixture?.date ??
      null,

    timestamp:
      match.fixture?.timestamp ??
      null,

    timezone:
      match.fixture?.timezone ??
      TZ,

    venue:
      match.fixture?.venue ||
      null,

    referee:
      match.fixture?.referee ||
      null,

    status:
      match.fixture?.status?.short ??
      null,

    statusLong:
      match.fixture?.status?.long ??
      null,

    elapsed:
      match.fixture?.status?.elapsed ??
      null,

    league: {
      id:
        match.league?.id ??
        null,

      name:
        match.league?.name ??
        null,

      country:
        match.league?.country ??
        null,

      logo:
        match.league?.logo ??
        null,

      flag:
        match.league?.flag ??
        null,

      season:
        match.league?.season ??
        null,

      round:
        match.league?.round ??
        null
    },

    home: {
      id:
        match.teams?.home?.id ??
        null,

      name:
        match.teams?.home?.name ??
        null,

      logo:
        match.teams?.home?.logo ??
        null,

      winner:
        match.teams?.home?.winner ??
        null
    },

    away: {
      id:
        match.teams?.away?.id ??
        null,

      name:
        match.teams?.away?.name ??
        null,

      logo:
        match.teams?.away?.logo ??
        null,

      winner:
        match.teams?.away?.winner ??
        null
    },

    score: {
      home:
        match.goals?.home ??
        null,

      away:
        match.goals?.away ??
        null
    },

    goals: {
      home:
        match.goals?.home ??
        null,

      away:
        match.goals?.away ??
        null
    },

    periods:
      match.score ||
      null
  };
}

// ==========================================
// BUGÜNÜN / TARİHİN MAÇLARI
// ==========================================

async function fixtures(
  env,
  ctx,
  cors,
  url
) {
  const date =
    param(url, "date") ||
    todayTR();

  return cached(
    ctx,
    `${url.origin}/_cache/fixtures?date=${date}`,
    180,

    async () => {
      const data =
        await apiFetch(
          "/fixtures",
          {
            date,
            timezone: TZ
          },
          env
        );

      const matches =
        (data.response || [])
          .map(mapFixture);

      return json(
        {
          success: true,
          date,
          timezone: TZ,
          count:
            matches.length,
          matches
        },
        200,
        cors,
        180
      );
    }
  );
}

// ==========================================
// CANLI MAÇLAR
// ==========================================

async function live(
  env,
  ctx,
  cors,
  url
) {
  return cached(
    ctx,
    `${url.origin}/_cache/live`,
    20,

    async () => {
      const data =
        await apiFetch(
          "/fixtures",
          {
            live: "all",
            timezone: TZ
          },
          env
        );

      const matches =
        (data.response || [])
          .map(mapFixture);

      return json(
        {
          success: true,
          count:
            matches.length,
          matches
        },
        200,
        cors,
        20
      );
    }
  );
}

// ==========================================
// MAÇ DETAY
// ==========================================

async function fixtureDetail(
  env,
  ctx,
  cors,
  url
) {
  const id =
    param(url, "id") ||
    param(url, "fixture");

  if (!numeric(id)) {
    return json(
      {
        success: false,
        error:
          "Geçerli fixture ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/fixture?id=${id}`,
    45,

    async () => {
      const data =
        await apiFetch(
          "/fixtures",
          {
            id,
            timezone: TZ
          },
          env
        );

      const raw =
        data.response?.[0];

      if (!raw) {
        return json(
          {
            success: false,
            error:
              "Maç bulunamadı."
          },
          404,
          cors
        );
      }

      return json(
        {
          success: true,
          match:
            mapFixture(raw),
          raw
        },
        200,
        cors,
        45
      );
    }
  );
}

// ==========================================
// CANLI DETAY
// ==========================================

async function liveDetail(
  env,
  ctx,
  cors,
  url
) {
  const fixture =
    param(url, "fixture") ||
    param(url, "id");

  if (!numeric(fixture)) {
    return json(
      {
        success: false,
        error: "Geçerli fixture ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/live-detail-v4?fixture=${fixture}`,
    15,

    async () => {
      const [
        fixtureData,
        statisticsData,
        eventsData,
        lineupsData
      ] = await Promise.all([
        apiFetch(
          "/fixtures",
          {
            id: fixture,
            timezone: TZ
          },
          env
        ),

        apiFetch(
          "/fixtures/statistics",
          { fixture },
          env
        ).catch(() => ({
          response: []
        })),

        apiFetch(
          "/fixtures/events",
          { fixture },
          env
        ).catch(() => ({
          response: []
        })),

        apiFetch(
          "/fixtures/lineups",
          { fixture },
          env
        ).catch(() => ({
          response: []
        }))
      ]);

      const raw =
        fixtureData.response?.[0];

      if (!raw) {
        return json(
          {
            success: false,
            error: "Maç bulunamadı."
          },
          404,
          cors
        );
      }

      const homeTeamId =
        raw.teams?.home?.id;

      const awayTeamId =
        raw.teams?.away?.id;

      const stats =
        statisticsData.response || [];

      const homeStatsBlock =
        stats.find(
          item =>
            Number(item.team?.id) ===
            Number(homeTeamId)
        ) ||
        stats[0] ||
        null;

      const awayStatsBlock =
        stats.find(
          item =>
            Number(item.team?.id) ===
            Number(awayTeamId)
        ) ||
        stats[1] ||
        null;

      function getStat(
        block,
        type
      ) {
        const item =
          block?.statistics?.find(
            stat =>
              stat.type === type
          );

        return item?.value ?? null;
      }

      function normalizeStats(
        block
      ) {
        if (!block) {
          return {};
        }

        return {
          totalShots:
            getStat(
              block,
              "Total Shots"
            ),

          shotsOnGoal:
            getStat(
              block,
              "Shots on Goal"
            ),

          shotsOffGoal:
            getStat(
              block,
              "Shots off Goal"
            ),

          blockedShots:
            getStat(
              block,
              "Blocked Shots"
            ),

          corners:
            getStat(
              block,
              "Corner Kicks"
            ),

          possession:
            getStat(
              block,
              "Ball Possession"
            ),

          fouls:
            getStat(
              block,
              "Fouls"
            ),

          offsides:
            getStat(
              block,
              "Offsides"
            ),

          yellowCards:
            getStat(
              block,
              "Yellow Cards"
            ),

          redCards:
            getStat(
              block,
              "Red Cards"
            ),

          saves:
            getStat(
              block,
              "Goalkeeper Saves"
            )
        };
      }

      const events =
        (
          eventsData.response ||
          []
        ).map(
          event => ({
            time:
              event.time || {},

            team:
              event.team || {},

            player:
              event.player || {},

            assist:
              event.assist || {},

            type:
              event.type || null,

            detail:
              event.detail || null,

            comments:
              event.comments || null
          })
        );

      const payload = {
        success: true,

        fixture: {
          id:
            raw.fixture?.id ||
            Number(fixture),

          date:
            raw.fixture?.date ||
            null,

          referee:
            raw.fixture?.referee ||
            null,

          venue: {
            name:
              raw.fixture?.venue?.name ||
              null,

            city:
              raw.fixture?.venue?.city ||
              null
          },

          status: {
            long:
              raw.fixture?.status?.long ||
              null,

            short:
              raw.fixture?.status?.short ||
              null,

            elapsed:
              raw.fixture?.status?.elapsed ??
              null,

            extra:
              raw.fixture?.status?.extra ??
              null
          }
        },

        league: {
          id:
            raw.league?.id ||
            null,

          name:
            raw.league?.name ||
            null,

          country:
            raw.league?.country ||
            null,

          logo:
            raw.league?.logo ||
            null,

          flag:
            raw.league?.flag ||
            null,

          season:
            raw.league?.season ||
            null,

          round:
            raw.league?.round ||
            null
        },

        teams: {
          home: {
            id:
              homeTeamId ||
              null,

            name:
              raw.teams?.home?.name ||
              null,

            logo:
              raw.teams?.home?.logo ||
              null
          },

          away: {
            id:
              awayTeamId ||
              null,

            name:
              raw.teams?.away?.name ||
              null,

            logo:
              raw.teams?.away?.logo ||
              null
          }
        },

        goals: {
          home:
            raw.goals?.home ??
            null,

          away:
            raw.goals?.away ??
            null
        },

        score:
          raw.score || {},

        statistics: {
          available:
            stats.length > 0,

          home:
            normalizeStats(
              homeStatsBlock
            ),

          away:
            normalizeStats(
              awayStatsBlock
            )
        },

        events: {
          available:
            events.length > 0,

          count:
            events.length,

          items:
            events
        },

        lineups:
          lineupsData.response ||
          [],

        availability: {
          fixture: true,

          statistics:
            stats.length > 0,

          events:
            events.length > 0,

          lineups:
            (
              lineupsData.response ||
              []
            ).length > 0
        }
      };

      return json(
        payload,
        200,
        cors,
        15
      );
    }
  );
}
// ==========================================
// API FOOTBALL TAHMİNİ
// ==========================================

async function prediction(
  env,
  ctx,
  cors,
  url
) {
  const fixture =
    param(url, "fixture");

  if (!numeric(fixture)) {
    return json(
      {
        success: false,
        error:
          "Geçerli fixture ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/prediction?fixture=${fixture}`,
    1800,

    async () => {
      const data =
        await apiFetch(
          "/predictions",
          { fixture },
          env
        );

      const item =
        data.response?.[0];

      if (!item) {
        return json(
          {
            success: false,
            error:
              "Bu maç için tahmin verisi yok."
          },
          404,
          cors
        );
      }

      const p =
        item.predictions ||
        {};

      return json(
        {
          success: true,

          fixture:
            Number(fixture),

          prediction: {
            winner:
              p.winner?.name ||
              null,

            winnerComment:
              p.winner?.comment ||
              null,

            winOrDraw:
              p.win_or_draw ??
              null,

            underOver:
              p.under_over ||
              null,

            advice:
              p.advice ||
              null,

            goals: {
              home:
                p.goals?.home ??
                null,

              away:
                p.goals?.away ??
                null
            },

            percent: {
              home:
                p.percent?.home ||
                null,

              draw:
                p.percent?.draw ||
                null,

              away:
                p.percent?.away ||
                null
            }
          },

          comparison:
            item.comparison ||
            null,

          teams:
            item.teams ||
            null
        },
        200,
        cors,
        1800
      );
    }
  );
}

// ==========================================
// KENDİ MODELİMİZ
// ==========================================

function completed(list) {
  const completedStatuses =
    new Set([
      "FT",
      "AET",
      "PEN"
    ]);

  return (list || [])
    .filter(
      match =>
        completedStatuses.has(
          match.fixture
            ?.status
            ?.short
        ) &&
        Number.isFinite(
          match.goals?.home
        ) &&
        Number.isFinite(
          match.goals?.away
        )
    );
}

function statsFor(list) {
  if (!list.length) {
    return {
      sample: 0,
      over15: 0,
      over25: 0,
      btts: 0,
      avgGoals: 0
    };
  }

  let over15 = 0;
  let over25 = 0;
  let btts = 0;
  let totalGoals = 0;

  for (const match of list) {
    const home =
      Number(
        match.goals.home
      );

    const away =
      Number(
        match.goals.away
      );

    const total =
      home + away;

    totalGoals += total;

    if (total >= 2) {
      over15++;
    }

    if (total >= 3) {
      over25++;
    }

    if (
      home > 0 &&
      away > 0
    ) {
      btts++;
    }
  }

  return {
    sample:
      list.length,

    over15:
      Math.round(
        over15 /
        list.length *
        100
      ),

    over25:
      Math.round(
        over25 /
        list.length *
        100
      ),

    btts:
      Math.round(
        btts /
        list.length *
        100
      ),

    avgGoals:
      Number(
        (
          totalGoals /
          list.length
        ).toFixed(2)
      )
  };
}

function blend(
  home,
  away,
  key
) {
  if (
    !home.sample &&
    !away.sample
  ) {
    return 0;
  }

  if (!home.sample) {
    return away[key];
  }

  if (!away.sample) {
    return home[key];
  }

  return Math.round(
    (
      home[key] +
      away[key]
    ) / 2
  );
}

function confidence(
  score,
  sample
) {
  if (sample < 6) {
    return "Düşük";
  }

  if (
    score >= 72 ||
    score <= 28
  ) {
    return "Yüksek";
  }

  if (
    score >= 62 ||
    score <= 38
  ) {
    return "Orta";
  }

  return "Düşük";
}

async function model(
  env,
  ctx,
  cors,
  url
) {
  const home =
    param(url, "home");

  const away =
    param(url, "away");

  if (
    !numeric(home) ||
    !numeric(away)
  ) {
    return json(
      {
        success: false,
        error:
          "Geçerli home ve away takım ID'leri gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/model?home=${home}&away=${away}`,
    3600,

    async () => {
      const [
        homeData,
        awayData
      ] =
        await Promise.all([
          apiFetch(
            "/fixtures",
            {
              team: home,
              last: 8,
              timezone: TZ
            },
            env
          ),

          apiFetch(
            "/fixtures",
            {
              team: away,
              last: 8,
              timezone: TZ
            },
            env
          )
        ]);

      const homeStats =
        statsFor(
          completed(
            homeData.response
          )
        );

      const awayStats =
        statsFor(
          completed(
            awayData.response
          )
        );

      const sample =
        homeStats.sample +
        awayStats.sample;

      const over15 =
        blend(
          homeStats,
          awayStats,
          "over15"
        );

      const over25 =
        blend(
          homeStats,
          awayStats,
          "over25"
        );

      const btts =
        blend(
          homeStats,
          awayStats,
          "btts"
        );

      const divisor =
        (
          homeStats.sample
            ? 1
            : 0
        ) +
        (
          awayStats.sample
            ? 1
            : 0
        ) || 1;

      const averageTotalGoals =
        Number(
          (
            (
              homeStats.avgGoals +
              awayStats.avgGoals
            ) /
            divisor
          ).toFixed(2)
        );

      return json(
        {
          success: true,

          methodology:
            "İki takımın son tamamlanmış maçlarındaki gol eğilimleri.",

          sample,

          scores: {
            over15,
            over25,
            btts
          },

          confidence: {
            over15:
              confidence(
                over15,
                sample
              ),

            over25:
              confidence(
                over25,
                sample
              ),

            btts:
              confidence(
                btts,
                sample
              )
          },

          recent: {
            home:
              homeStats,

            away:
              awayStats
          },

          averageTotalGoals
        },
        200,
        cors,
        3600
      );
    }
  );
}

// ==========================================
// TAKIM ARAMA
// ==========================================

async function teamSearch(
  env,
  ctx,
  cors,
  url
) {
  const query =
    param(url, "q") ||
    param(url, "search") ||
    param(url, "name");

  if (query.length < 2) {
    return json(
      {
        success: false,
        error:
          "En az 2 karakterlik takım adı gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/team-search?q=${encodeURIComponent(query.toLowerCase())}`,
    21600,

    async () => {
      const data =
        await apiFetch(
          "/teams",
          {
            search: query
          },
          env
        );

      const teams =
        (data.response || [])
          .map(item => ({
            id:
              item.team?.id,

            name:
              item.team?.name,

            code:
              item.team?.code,

            country:
              item.team?.country,

            founded:
              item.team?.founded,

            national:
              item.team?.national,

            logo:
              item.team?.logo,

            venue:
              item.venue ||
              null
          }));

      return json(
        {
          success: true,
          count:
            teams.length,
          teams
        },
        200,
        cors,
        21600
      );
    }
  );
}

// ==========================================
// TAKIM BİLGİSİ
// ==========================================

async function teamInfo(
  env,
  ctx,
  cors,
  url
) {
  const id =
    param(url, "id") ||
    param(url, "team");

  if (!numeric(id)) {
    return json(
      {
        success: false,
        error:
          "Geçerli takım ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/team?id=${id}`,
    21600,

    async () => {
      const data =
        await apiFetch(
          "/teams",
          { id },
          env
        );

      const item =
        data.response?.[0];

      if (!item) {
        return json(
          {
            success: false,
            error:
              "Takım bulunamadı."
          },
          404,
          cors
        );
      }

      return json(
        {
          success: true,
          team:
            item.team,

          venue:
            item.venue ||
            null
        },
        200,
        cors,
        21600
      );
    }
  );
}

// ==========================================
// TAKIM SON MAÇLARI / FORM
// ==========================================

async function teamForm(
  env,
  ctx,
  cors,
  url
) {
  const id =
    param(url, "id") ||
    param(url, "team");

  const last =
    Math.min(
      Math.max(
        parseInt(
          param(
            url,
            "last"
          ) || "10",
          10
        ) || 10,
        1
      ),
      20
    );

  if (!numeric(id)) {
    return json(
      {
        success: false,
        error:
          "Geçerli takım ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/team-form?id=${id}&last=${last}`,
    900,

    async () => {
      const data =
        await apiFetch(
          "/fixtures",
          {
            team: id,
            last,
            timezone: TZ
          },
          env
        );

      const matches =
        (data.response || [])
          .map(mapFixture);

      return json(
        {
          success: true,
          team:
            Number(id),
          count:
            matches.length,
          matches
        },
        200,
        cors,
        900
      );
    }
  );
}

// ==========================================
// KADRO
// ==========================================

async function squad(
  env,
  ctx,
  cors,
  url
) {
  const team =
    param(url, "team") ||
    param(url, "id");

  if (!numeric(team)) {
    return json(
      {
        success: false,
        error:
          "Geçerli takım ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/squad?team=${team}`,
    21600,

    async () => {
      const data =
        await apiFetch(
          "/players/squads",
          { team },
          env
        );

      return json(
        {
          success: true,
          team:
            Number(team),
          squads:
            data.response ||
            []
        },
        200,
        cors,
        21600
      );
    }
  );
}

// ==========================================
// PUAN DURUMU
// ==========================================

async function standings(
  env,
  ctx,
  cors,
  url
) {
  const competition =
    param(url, "competition");

  const league =
    param(url, "league");

  const season =
    param(url, "season");

  // Football-Data
  if (competition) {
    if (!env.FOOTBALL_DATA_KEY) {
      return json(
        {
          success: false,
          error: "FOOTBALL_DATA_KEY bulunamadı."
        },
        500,
        cors
      );
    }

    try {
      const response =
        await fetch(
          `https://api.football-data.org/v4/competitions/${encodeURIComponent(
            competition
          )}/standings`,
          {
            headers: {
              "X-Auth-Token":
                env.FOOTBALL_DATA_KEY
            },
            signal:
              AbortSignal.timeout(12000)
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        return json(
          {
            success: false,
            source: "football-data.org",
            error:
              data?.message ||
              "Puan durumu alınamadı."
          },
          response.status,
          cors
        );
      }

      const totalStanding =
        (data.standings || [])
          .find(
            item =>
              item.type === "TOTAL"
          ) ||
        (data.standings || [])[0];

      const table =
        (
          totalStanding?.table ||
          []
        ).map(
          row => ({
            position:
              row.position ??
              null,

            team: {
              id:
                row.team?.id ??
                null,

              name:
                row.team?.name ||
                "",

              shortName:
                row.team?.shortName ||
                row.team?.tla ||
                row.team?.name ||
                "",

              crest:
                row.team?.crest ||
                null
            },

            played:
              row.playedGames ??
              0,

            won:
              row.won ??
              0,

            draw:
              row.draw ??
              0,

            lost:
              row.lost ??
              0,

            goalsFor:
              row.goalsFor ??
              0,

            goalsAgainst:
              row.goalsAgainst ??
              0,

            goalDifference:
              row.goalDifference ??
              0,

            points:
              row.points ??
              0,

            form:
              row.form ||
              null
          })
        );

      return json(
        {
          success: true,
          source: "football-data.org",

          competition: {
            id:
              data.competition?.id ||
              null,

            name:
              data.competition?.name ||
              competition,

            code:
              data.competition?.code ||
              competition,

            emblem:
              data.competition?.emblem ||
              null
          },

          season:
            data.season ||
            null,

          table
        },
        200,
        cors,
        1800
      );

    } catch (error) {
      return json(
        {
          success: false,
          source: "football-data.org",
          error:
            error?.name === "TimeoutError"
              ? "Puan durumu isteği zaman aşımına uğradı."
              : error?.message ||
                "Puan durumu alınamadı."
        },
        502,
        cors
      );
    }
  }


  // API-Football
  if (
    !numeric(league) ||
    !/^\d{4}$/.test(
      String(season || "")
    )
  ) {
    return json(
      {
        success: false,
        error:
          "Geçerli league ve season gerekli."
      },
      400,
      cors
    );
  }

  try {
    const apiUrl =
      new URL(
        API_BASE +
        "/standings"
      );

    apiUrl.searchParams.set(
      "league",
      league
    );

    apiUrl.searchParams.set(
      "season",
      season
    );

    const response =
      await fetch(
        apiUrl.toString(),
        {
          headers: {
            "x-apisports-key":
              env.API_FOOTBALL_KEY
          },
          signal:
            AbortSignal.timeout(12000)
        }
      );

    const data =
      await response.json();

    const errors =
      apiErrors(data);

    if (
      !response.ok ||
      errors.length
    ) {
      return json(
        {
          success: false,
          source: "API-Football",

          error:
            "Puan durumu alınamadı.",

          apiErrors:
            data.errors || {}
        },
        502,
        cors
      );
    }

    const leagueData =
      data.response?.[0]
        ?.league;

    const rawTable =
      leagueData
        ?.standings
        ?.[0] ||
      [];

    if (
      !Array.isArray(
        rawTable
      )
    ) {
      return json(
        {
          success: false,
          source: "API-Football",
          error:
            "Bu lig için puan durumu bulunamadı."
        },
        404,
        cors
      );
    }

    const table =
      rawTable.map(
        row => ({
          position:
            row.rank ??
            null,

          team: {
            id:
              row.team?.id ??
              null,

            name:
              row.team?.name ||
              "",

            shortName:
              row.team?.name ||
              "",

            crest:
              row.team?.logo ||
              null
          },

          played:
            row.all?.played ??
            0,

          won:
            row.all?.win ??
            0,

          draw:
            row.all?.draw ??
            0,

          lost:
            row.all?.lose ??
            0,

          goalsFor:
            row.all
              ?.goals
              ?.for ??
            0,

          goalsAgainst:
            row.all
              ?.goals
              ?.against ??
            0,

          goalDifference:
            row.goalsDiff ??
            0,

          points:
            row.points ??
            0,

          form:
            row.form ||
            null
        })
      );

    return json(
      {
        success: true,
        source: "API-Football",

        competition: {
          id:
            leagueData?.id ||
            Number(league),

          name:
            leagueData?.name ||
            "",

          code:
            null,

          emblem:
            leagueData?.logo ||
            null
        },

        season: {
          year:
            Number(season)
        },

        table
      },
      200,
      cors,
      1800
    );

  } catch (error) {
    return json(
      {
        success: false,
        source: "API-Football",

        error:
          error?.name === "TimeoutError"
            ? "Puan durumu isteği zaman aşımına uğradı."
            : error?.message ||
              "Puan durumu alınamadı."
      },
      502,
      cors
    );
  }
}

// ==========================================
// LİGLER
// ==========================================

async function leagues(
  env,
  ctx,
  cors,
  url
) {
  const params = {};

  for (
    const key of [
      "id",
      "name",
      "country",
      "code",
      "season",
      "team",
      "type",
      "current"
    ]
  ) {
    const value =
      param(url, key);

    if (value) {
      params[key] =
        value;
    }
  }

  return cached(
    ctx,
    `${url.origin}/_cache/leagues?${new URLSearchParams(params)}`,
    21600,

    async () => {
      const data =
        await apiFetch(
          "/leagues",
          params,
          env
        );

      return json(
        {
          success: true,
          count:
            (
              data.response ||
              []
            ).length,

          leagues:
            data.response ||
            []
        },
        200,
        cors,
        21600
      );
    }
  );
}

// ==========================================
// THE SPORTS DB - TAKIM ARAMA
// ==========================================

async function sportsDbTeamSearch(
  ctx,
  cors,
  url
) {
  const query =
    param(url, "q") ||
    param(url, "name");

  if (query.length < 2) {
    return json(
      {
        success: false,
        error:
          "En az 2 karakterlik takım adı gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/sportsdb-search?q=${encodeURIComponent(query.toLowerCase())}`,
    21600,

    async () => {
      const response =
        await fetch(
          `${SPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(query)}`
        );

      if (!response.ok) {
        throw new Error(
          "TheSportsDB isteği başarısız."
        );
      }

      const data =
        await response.json();

      const teams =
        (data.teams || [])
          .map(team => ({
            id:
              team.idTeam,

            name:
              team.strTeam,

            alternate:
              team.strTeamAlternate ||
              null,

            league:
              team.strLeague ||
              null,

            country:
              team.strCountry ||
              null,

            badge:
              team.strBadge ||
              null,

            stadium:
              team.strStadium ||
              null,

            description:
              team.strDescriptionEN ||
              null
          }));

      return json(
        {
          success: true,
          count:
            teams.length,
          teams
        },
        200,
        cors,
        21600
      );
    }
  );
}

// ==========================================
// THE SPORTS DB - SON MAÇLAR
// ==========================================

async function sportsDbLastEvents(
  ctx,
  cors,
  url
) {
  const teamId =
    param(url, "team") ||
    param(url, "id");

  const last =
    Math.min(
      Math.max(
        parseInt(
          param(
            url,
            "last"
          ) || "5",
          10
        ) || 5,
        1
      ),
      15
    );

  if (!numeric(teamId)) {
    return json(
      {
        success: false,
        error:
          "Geçerli TheSportsDB team ID gerekli."
      },
      400,
      cors
    );
  }

  return cached(
    ctx,
    `${url.origin}/_cache/sportsdb-last?team=${teamId}&last=${last}`,
    1800,

    async () => {
      const response =
        await fetch(
          `${SPORTSDB_BASE}/eventslast.php?id=${encodeURIComponent(teamId)}`
        );

      if (!response.ok) {
        throw new Error(
          "TheSportsDB isteği başarısız."
        );
      }

      const data =
        await response.json();

      const events =
        (
          data.results ||
          data.events ||
          []
        )
          .slice(
            0,
            last
          )
          .map(
            event => ({
              id:
                event.idEvent,

              date:
                event.dateEvent,

              time:
                event.strTime ||
                null,

              league:
                event.strLeague ||
                null,

              home: {
                id:
                  event.idHomeTeam ||
                  null,

                name:
                  event.strHomeTeam ||
                  null,

                score:
                  event.intHomeScore ??
                  null
              },

              away: {
                id:
                  event.idAwayTeam ||
                  null,

                name:
                  event.strAwayTeam ||
                  null,

                score:
                  event.intAwayScore ??
                  null
              },

              status:
                event.strStatus ||
                null,

              season:
                event.strSeason ||
                null,

              round:
                event.intRound ||
                null
            })
          );

      return json(
        {
          success: true,
          team:
            teamId,
          count:
            events.length,
          events
        },
        200,
        cors,
        1800
      );
    }
  );
}
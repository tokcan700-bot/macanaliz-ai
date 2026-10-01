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

    const date =
      url.searchParams.get("date") ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Istanbul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());

    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = "/api/fixtures";
    cacheUrl.search = "?date=" + encodeURIComponent(date);

    const cacheKey = new Request(cacheUrl.toString());
    const cache = caches.default;

    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }

    const apiUrl = new URL(
      "https://v3.football.api-sports.io/fixtures"
    );

    apiUrl.searchParams.set("date", date);
    apiUrl.searchParams.set("timezone", "Europe/Istanbul");

    const response = await fetch(apiUrl.toString(), {
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY
      }
    });

    const data = await response.json();

    const apiErrors =
      data.errors && typeof data.errors === "object"
        ? Object.keys(data.errors)
        : [];

    if (!response.ok || apiErrors.length > 0) {
      return Response.json(
        {
          success: false,
          status: response.status,
          errors: data.errors || {}
        },
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
  }
};

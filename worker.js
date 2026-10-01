export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=UTF-8"
    };

    if (!env.API_FOOTBALL_KEY) {
      return Response.json(
        { success: false, error: "API_FOOTBALL_KEY bulunamadı." },
        { status: 500, headers }
      );
    }

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    const apiUrl =
      "https://v3.football.api-sports.io/fixtures?date=" +
      today +
      "&timezone=Europe%2FIstanbul";

    const response = await fetch(apiUrl, {
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY
      }
    });

    const data = await response.json();

  return Response.json(
  {
    success: response.ok,
    status: response.status,
    date: today,
    count: data.results || 0,
    errors: data.errors || {},
    message: data.message || null,
    matches: data.response || []
  },
  { headers }
);

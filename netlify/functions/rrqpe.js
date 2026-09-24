export const handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      disponivel: false,
      fonte: 'RRQPE NOAA',
      mensagem: 'RRQPE NOAA: indisponível no mapa no momento. O produto NetCDF ainda não possui serviço de rasterização para tiles HTTPS.',
    }),
  }
}
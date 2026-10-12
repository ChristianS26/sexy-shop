# Activos de marca

El ERP usa un único punto de entrada para el logotipo:

- `logo.svg` (o `logo.png`) — isotipo/logotipo oficial de SONROJA. **Pendiente de recibir la guía de identidad.**
  Mientras no exista el archivo, la interfaz muestra un monograma "S" generado con la paleta oficial y el wordmark tipográfico
  "SONROJA" en Playfair Display. Al colocar `logo.svg` aquí no hace falta tocar código: `app.js` lo detecta y lo usa en
  sidebar, login y ticket sin alterar proporciones (se ajusta con `object-fit: contain`).

No se inventan elementos de marca: colores y tipografías provienen de la guía descrita por el cliente (ver `css/tokens.css`).

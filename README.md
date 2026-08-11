# Miño Goup Sorteo

Sistema para vender boletas del sorteo Toyota Vitz 2013 con:

- Bot de WhatsApp.
- Panel premium con login de admin y vendedores.
- Generacion de boletas PDF con QR.
- Control de ventas por vendedor.
- Verificador QR para detectar boletas invalidas o ya escaneadas.

## Uso local

```bat
npm install
npm.cmd start
```

Abrir:

```text
http://localhost:3000/premium/
```

Usuario inicial:

```text
admin / admin123
```

## Produccion

Para subir solo el sistema web:

```bat
npm.cmd run online
```

Variables recomendadas:

```text
APP_SECRET=un_secreto_largo
ADMIN_USER=admin
ADMIN_PASSWORD=una_contrasena_segura
ONLINE_PORT=3000
```

El bot se mantiene con:

```bat
npm.cmd run bot
```

## Control

El admin puede:

- Crear vendedores con usuario y contrasena.
- Ver todas las ventas.
- Cargar ventas para cualquier vendedor.
- Escanear QR de boletas.
- Detectar si una boleta ya fue escaneada.

El vendedor puede:

- Entrar con su usuario.
- Cargar ventas propias.
- Generar boletas PDF.
- Ver solo sus ventas.

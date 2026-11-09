
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 3000;
const HOST = "0.0.0.0";
const ROOT = path.join(__dirname, "public");
const DB = path.join(__dirname, "datos.json");

const CLIENTS = new Set();

const productosIniciales = [
  { id: "p1", name: "Fresas con crema", category: "Postres", price: 85, emoji: "🍓", active: true },
  { id: "p2", name: "Mini hotcakes", category: "Postres", price: 90, emoji: "🥞", active: true },
  { id: "p3", name: "Cheesecake", category: "Postres", price: 75, emoji: "🍰", active: true },
  { id: "p4", name: "Brownie con nieve", category: "Postres", price: 95, emoji: "🍫", active: true },
  { id: "p5", name: "Papas preparadas", category: "Botanas", price: 65, emoji: "🍟", active: true },
  { id: "p6", name: "Chicharrones preparados", category: "Botanas", price: 70, emoji: "🌶️", active: true },
  { id: "p7", name: "Tostilocos", category: "Botanas", price: 80, emoji: "🥙", active: true },
  { id: "p8", name: "Manzana con chamoy", category: "Fruta", price: 55, emoji: "🍏", active: true },
  { id: "p9", name: "Malteada de fresa", category: "Bebidas", price: 68, emoji: "🥤", active: true },
  { id: "p10", name: "Agua fresca", category: "Bebidas", price: 35, emoji: "🧃", active: true }
];

const inicial = {
  products: productosIniciales,
  orders: []
};

let db;

try {
  db = JSON.parse(fs.readFileSync(DB, "utf8"));
  if (!Array.isArray(db.products) || !Array.isArray(db.orders)) {
    throw new Error("Datos inválidos");
  }
} catch {
  db = structuredClone(inicial);
}

function guardar() {
  const temp = DB + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB);
}

function responder(res, codigo, datos) {
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(datos));
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let contenido = "";

    req.on("data", parte => {
      contenido += parte;

      if (contenido.length > 150000) {
        reject(new Error("Solicitud demasiado grande"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(contenido || "{}"));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });

    req.on("error", reject);
  });
}

// Avisar a caja, cocina y administrador
function notificarPantallas() {
  for (const cliente of CLIENTS) {
    try {
      cliente.write("event: changed\ndata: {}\n\n");
    } catch {
      CLIENTS.delete(cliente);
    }
  }
}

function fechaLocal(fecha) {
  return new Date(fecha).toLocaleDateString("en-CA", {
    timeZone: "America/Matamoros"
  });
}

function precioValido(n) {
  return Number.isFinite(n) &&
    n > 0 &&
    n < 1000000 &&
    Math.round(n * 100) === n * 100;
}

const tipos = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const servidor = http.createServer(async (req, res) => {
  try {
    let ruta = new URL(req.url, "http://localhost").pathname;

    // CONEXIÓN EN TIEMPO REAL
    if (req.method === "GET" && ruta === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      });

      res.write("event: connected\ndata: {}\n\n");
      CLIENTS.add(res);

      req.on("close", () => CLIENTS.delete(res));
      return;
    }

    // OBTENER PRODUCTOS Y PEDIDOS
    if (req.method === "GET" && ruta === "/api/state") {
      return responder(res, 200, db);
    }

    // REPORTE DE VENTAS DEL DÍA
    if (req.method === "GET" && ruta === "/api/summary") {
      const hoy = fechaLocal(new Date());

      const pedidos = db.orders.filter(
        p => fechaLocal(p.createdAt) === hoy
      );

      const pagados = pedidos.filter(
        p => p.paymentStatus === "Pagado"
      );

      const total = pagados.reduce(
        (suma, p) => suma + p.total, 0
      );

      const metodos = {
        Efectivo: 0,
        Transferencia: 0,
        Tarjeta: 0
      };

      pagados.forEach(p => {
        metodos[p.paymentMethod] =
          (metodos[p.paymentMethod] || 0) + p.total;
      });

      return responder(res, 200, {
        today: hoy,
        count: pedidos.length,
        total,
        byMethod: metodos,
        pending: pedidos.filter(p =>
          ["Pendiente", "Preparando"].includes(p.status)
        ).length,
        orders: pedidos
      });
    }

    // REGISTRAR NUEVO PEDIDO EN CAJA
    if (req.method === "POST" && ruta === "/api/orders") {
      const body = await leerBody(req);

      if (!Array.isArray(body.items) ||
          body.items.length === 0 ||
          body.items.length > 60) {
        return responder(res, 400, {
          error: "Agrega productos al pedido."
        });
      }

      const items = [];

      for (const item of body.items) {
        const producto = db.products.find(
          p => p.id === item.id && p.active !== false
        );

        const cantidad = Number(item.qty);

        if (!producto ||
            !Number.isInteger(cantidad) ||
            cantidad < 1 ||
            cantidad > 100) {
          return responder(res, 400, {
            error: "Producto o cantidad inválida."
          });
        }

        items.push({
          id: producto.id,
          name: producto.name,
          qty: cantidad,
          price: producto.price,
          subtotal: Math.round(
            producto.price * cantidad * 100
          ) / 100
        });
      }

      const total = Math.round(
        items.reduce((s, i) => s + i.subtotal, 0) * 100
      ) / 100;

      const metodo = body.paymentMethod;

      if (!["Efectivo", "Transferencia", "Tarjeta"]
          .includes(metodo)) {
        return responder(res, 400, {
          error: "Método de pago inválido."
        });
      }

      const recibido = Number(body.received);

      if (metodo === "Efectivo" &&
          (!Number.isFinite(recibido) || recibido < total)) {
        return responder(res, 400, {
          error: "Efectivo insuficiente."
        });
      }

      const pedido = {
        id: crypto.randomUUID(),
        folio: db.orders.length + 1,
        createdAt: new Date().toISOString(),
        customer: String(body.customer || "Mostrador")
          .trim().slice(0, 90) || "Mostrador",
        notes: String(body.notes || "").trim().slice(0, 350),
        items,
        total,
        paymentMethod: metodo,
        paymentStatus: "Pagado",
        received: metodo === "Efectivo" ? recibido : total,
        change: metodo === "Efectivo"
          ? Math.round((recibido - total) * 100) / 100
          : 0,
        status: "Pendiente"
      };

      db.orders.unshift(pedido);
      guardar();
      notificarPantallas();

      return responder(res, 201, pedido);
    }

    // CAMBIAR ESTADO DE UN PEDIDO
    const estadoRuta = ruta.match(
      /^\/api\/orders\/([^/]+)\/status$/
    );

    if (req.method === "PATCH" && estadoRuta) {
      const body = await leerBody(req);

      const pedido = db.orders.find(
        p => p.id === estadoRuta[1]
      );

      if (!pedido) {
        return responder(res, 404, {
          error: "Pedido no encontrado."
        });
      }

      if (!["Pendiente", "Preparando", "Listo", "Entregado"]
          .includes(body.status)) {
        return responder(res, 400, {
          error: "Estado inválido."
        });
      }

      pedido.status = body.status;

      guardar();
      notificarPantallas();

      return responder(res, 200, pedido);
    }

    // AGREGAR PRODUCTO DESDE ADMINISTRACIÓN
    if (req.method === "POST" && ruta === "/api/products") {
      const body = await leerBody(req);

      const name = String(body.name || "").trim().slice(0, 70);
      const category = String(body.category || "")
        .trim().slice(0, 40);
      const price = Number(body.price);

      if (!name || !category || !precioValido(price)) {
        return responder(res, 400, {
          error: "Datos de producto inválidos."
        });
      }

      const producto = {
        id: crypto.randomUUID(),
        name,
        category,
        price,
        emoji: String(body.emoji || "🍬").slice(0, 8),
        active: true
      };

      db.products.push(producto);

      guardar();
      notificarPantallas();

      return responder(res, 201, producto);
    }

    // EDITAR O ACTIVAR / OCULTAR PRODUCTO
    const productoRuta = ruta.match(
      /^\/api\/products\/([^/]+)$/
    );

    if (req.method === "PATCH" && productoRuta) {
      const body = await leerBody(req);

      const producto = db.products.find(
        p => p.id === productoRuta[1]
      );

      if (!producto) {
        return responder(res, 404, {
          error: "Producto no encontrado."
        });
      }

      const name = String(body.name ?? producto.name)
        .trim().slice(0, 70);
      const category = String(
        body.category ?? producto.category
      ).trim().slice(0, 40);
      const price = Number(body.price ?? producto.price);

      if (!name || !category || !precioValido(price)) {
        return responder(res, 400, {
          error: "Datos inválidos."
        });
      }

      Object.assign(producto, {
        name,
        category,
        price,
        emoji: String(body.emoji ?? producto.emoji)
          .slice(0, 8),
        active: body.active === undefined
          ? producto.active
          : Boolean(body.active)
      });

      guardar();
      notificarPantallas();

      return responder(res, 200, producto);
    }

    // SERVIR ARCHIVOS HTML, CSS Y JS
    if (req.method === "GET" && ruta === "/") {
      ruta = "/caja.html";
    }

    if (req.method === "GET") {
      let archivo;

      try {
        archivo = path.resolve(
          ROOT,
          "." + decodeURIComponent(ruta)
        );
      } catch {
        return responder(res, 400, {
          error: "Ruta inválida."
        });
      }

      if (!archivo.startsWith(ROOT + path.sep)) {
        return responder(res, 403, {
          error: "Acceso no permitido."
        });
      }

      const tipo = tipos[path.extname(archivo)];

      if (!tipo) {
        return responder(res, 404, {
          error: "Archivo no encontrado."
        });
      }

      try {
        const contenido = fs.readFileSync(archivo);

        res.writeHead(200, {
          "Content-Type": tipo,
          "Cache-Control": "no-cache"
        });

        res.end(contenido);
      } catch {
        responder(res, 404, {
          error: "Página no encontrada."
        });
      }

      return;
    }

    responder(res, 404, {
      error: "Ruta desconocida."
    });

  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      responder(res, 500, {
        error: error.message || "Error interno."
      });
    }
  }
});

servidor.listen(PORT, HOST, () => {
  console.log("================================");
  console.log("🍓 DULCE ROSA - PUNTO DE VENTA");
  console.log("================================");
  console.log("Caja: http://localhost:3000/caja.html");
  console.log("Cocina: http://localhost:3000/cocina.html");
  console.log("Admin: http://localhost:3000/admin.html");
});

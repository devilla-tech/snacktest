
"use strict";

const $ = id => document.getElementById(id);

const money = n => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN"
}).format(n);

const esc = s => String(s ?? "").replace(
  /[&<>"']/g,
  c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]
);

const pagina = document.body.dataset.page;

let db = {
  products: [],
  orders: []
};

let carrito = {};
let categoria = "Todos";
let busqueda = "";
let temporizador;

// ==========================================
// MENSAJES
// ==========================================

function mensaje(texto) {
  const el = $("toast");

  el.textContent = texto;
  el.style.display = "block";

  clearTimeout(temporizador);

  temporizador = setTimeout(() => {
    el.style.display = "none";
  }, 3200);
}

// ==========================================
// CONEXIÓN CON SERVIDOR
// ==========================================

async function api(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(opciones.headers || {})
    }
  });

  const datos = await respuesta.json();

  if (!respuesta.ok) {
    throw new Error(datos.error || "Error del servidor");
  }

  return datos;
}

async function actualizar() {
  try {
    db = await api("/api/state");

    if (pagina === "caja") mostrarCaja();
    if (pagina === "cocina") mostrarCocina();
    if (pagina === "admin") await mostrarAdmin();

  } catch (error) {
    mensaje("Sin conexión: " + error.message);
  }
}

// Actualizaciones automáticas en tiempo real
function escucharCambios() {
  const eventos = new EventSource("/api/events");

  eventos.addEventListener("changed", () => {
    actualizar();
  });

  // Respaldo si una notificación se pierde
  setInterval(actualizar, 15000);
}

// ==========================================
// CAJA: PRODUCTOS
// ==========================================

function lineasCarrito() {
  return Object.entries(carrito)
    .map(([id, cantidad]) => ({
      producto: db.products.find(
        p => p.id === id && p.active !== false
      ),
      cantidad
    }))
    .filter(item =>
      item.producto && item.cantidad > 0
    );
}

function totalCarrito() {
  const total = lineasCarrito().reduce(
    (suma, item) =>
      suma + item.producto.price * item.cantidad,
    0
  );

  return Math.round(total * 100) / 100;
}

function mostrarCaja() {
  const productos = db.products.filter(
    p => p.active !== false
  );

  const categorias = [
    "Todos",
    ...new Set(productos.map(p => p.category))
  ];

  $("chips").innerHTML = categorias.map(cat => `
    <button
      data-cat="${esc(cat)}"
      class="${categoria === cat ? "active" : ""}">
      ${esc(cat)}
    </button>
  `).join("");

  $("chips").querySelectorAll("[data-cat]")
    .forEach(boton => {

      boton.onclick = () => {
        categoria = boton.dataset.cat;
        mostrarCaja();
      };

    });

  const filtrados = productos.filter(p =>
    (categoria === "Todos" || p.category === categoria) &&
    p.name.toLowerCase().includes(busqueda.toLowerCase())
  );

  $("products").innerHTML = filtrados.map(p => `
    <article class="product">
      <div>
        <div class="emoji">${esc(p.emoji)}</div>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.category)}</p>
      </div>

      <div class="product-foot">
        <span class="price">${money(p.price)}</span>

        <button class="btn" data-add="${esc(p.id)}">
          + Agregar
        </button>
      </div>
    </article>
  `).join("") || '<p class="empty">No hay productos.</p>';

  $("products").querySelectorAll("[data-add]")
    .forEach(boton => {

      boton.onclick = () => {
        const id = boton.dataset.add;

        carrito[id] = (carrito[id] || 0) + 1;

        mostrarCarrito();
      };
    });

  mostrarCarrito();
}

// ==========================================
// CAJA: CARRITO
// ==========================================

function mostrarCarrito() {
  const items = lineasCarrito();

  $("cart").innerHTML = items.map(({producto, cantidad}) => `
    <div class="cartrow">
      <div>
        <strong>${esc(producto.name)}</strong>
        <span class="small">
          ${money(cantidad * producto.price)}
        </span>
      </div>

      <div class="qty">
        <button
          data-id="${esc(producto.id)}"
          data-delta="-1">−</button>

        ${cantidad}

        <button
          data-id="${esc(producto.id)}"
          data-delta="1">+</button>
      </div>
    </div>
  `).join("") ||
  '<div class="empty">Sin productos en el pedido 💗</div>';

  $("cart").querySelectorAll("[data-id]")
    .forEach(boton => {

      boton.onclick = () => {
        const id = boton.dataset.id;
        const cambio = Number(boton.dataset.delta);

        carrito[id] += cambio;

        if (carrito[id] <= 0) {
          delete carrito[id];
        }

        mostrarCarrito();
      };
    });

  $("total").textContent = money(totalCarrito());
  calcularCambio();
}

function calcularCambio() {
  const recibido = Number($("received").value || 0);

  const cambio = Math.max(
    0,
    Math.round((recibido - totalCarrito()) * 100) / 100
  );

  $("change").textContent = money(cambio);
}

// ==========================================
// CAJA: REGISTRAR VENTA
// ==========================================

async function cobrar() {
  const items = lineasCarrito().map(
    ({producto, cantidad}) => ({
      id: producto.id,
      qty: cantidad
    })
  );

  if (!items.length) {
    mensaje("Selecciona algún producto.");
    return;
  }

  const metodo = $("method").value;

  if (metodo === "Efectivo") {
    const recibidoTexto = $("received").value.trim();
    const recibido = Number(recibidoTexto);

    if (
      recibidoTexto === "" ||
      !Number.isFinite(recibido) ||
      recibido < totalCarrito()
    ) {
      mensaje("Efectivo insuficiente.");
      return;
    }
  }

  const boton = $("checkout");
  boton.disabled = true;

  try {
    const pedido = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items,
        customer: $("customer").value,
        notes: $("notes").value,
        paymentMethod: metodo,
        received: $("received").value
      })
    });

    carrito = {};

    $("customer").value = "";
    $("notes").value = "";
    $("received").value = "";

    await actualizar();

    mensaje(
      `✅ Pedido #${pedido.folio} cobrado y enviado a cocina.`
    );

  } catch (error) {
    mensaje(error.message);

  } finally {
    boton.disabled = false;
  }
}

// ==========================================
// COCINA: CAMBIAR ESTADO
// ==========================================

async function cambiarEstado(id, estado) {
  try {
    await api(
      "/api/orders/" + encodeURIComponent(id) + "/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: estado })
      }
    );

    await actualizar();

  } catch (error) {
    mensaje(error.message);
  }
}

// ==========================================
// COCINA: MOSTRAR PEDIDOS
// ==========================================

function mostrarCocina() {
  const activos = db.orders.filter(
    p => p.status !== "Entregado"
  );

  $("orders").innerHTML = activos.map(pedido => `
    <article class="order">

      <div class="order-top">
        <div>
          <b>Pedido #${pedido.folio}</b>

          <div class="small">
            ${new Date(pedido.createdAt)
              .toLocaleString("es-MX")}
            · ${esc(pedido.customer)}
          </div>
        </div>

        <span class="pill">${esc(pedido.status)}</span>
      </div>

      <div class="order-items">
        ${pedido.items.map(item => `
          <div>
            <b>${item.qty}×</b> ${esc(item.name)}
          </div>
        `).join("")}
      </div>

      ${pedido.notes ? `
        <p><b>Nota:</b> ${esc(pedido.notes)}</p>
      ` : ""}

      <div class="actions">
        ${["Preparando", "Listo", "Entregado"]
          .map(estado => `
            <button
              data-id="${esc(pedido.id)}"
              data-status="${estado}"
              ${pedido.status === estado
                ? "disabled"
                : ""}>
              ${estado}
            </button>
          `).join("")}
      </div>

    </article>
  `).join("") ||
  '<div class="card empty">No hay pedidos pendientes. 🍓</div>';

  $("orders").querySelectorAll("[data-status]")
    .forEach(boton => {

      boton.onclick = () => {
        cambiarEstado(
          boton.dataset.id,
          boton.dataset.status
        );
      };
    });

  $("pending").textContent = activos.filter(
    p => p.status === "Pendiente"
  ).length;
}

// ==========================================
// ADMINISTRADOR: VENTAS DEL DÍA
// ==========================================

async function mostrarAdmin() {
  const resumen = await api("/api/summary");

  $("sales").textContent = money(resumen.total);
  $("count").textContent = resumen.count;
  $("pending").textContent = resumen.pending;

  $("cash").textContent = money(
    resumen.byMethod.Efectivo || 0
  );

  $("methods").textContent =
    "Transferencia: " +
    money(resumen.byMethod.Transferencia || 0) +
    " · Tarjeta: " +
    money(resumen.byMethod.Tarjeta || 0);

  $("recent").innerHTML = resumen.orders.map(pedido => `
    <div class="adminrow">
      <span>
        <b>#${pedido.folio}</b>
        ${esc(pedido.customer)}

        <span class="small">
          ${new Date(pedido.createdAt)
            .toLocaleTimeString("es-MX")}
          · ${esc(pedido.status)}
        </span>
      </span>

      <b>${money(pedido.total)}</b>
    </div>
  `).join("") ||
  '<p class="empty">Todavía no hay ventas hoy.</p>';

  // Productos del negocio
  $("adminProducts").innerHTML = db.products.map(p => `
    <div class="adminrow">
      <span>
        ${esc(p.emoji)}
        <b>${esc(p.name)}</b>

        <span class="small">
          ${esc(p.category)} · ${money(p.price)}
          ${p.active === false ? " · Oculto" : ""}
        </span>
      </span>

      <div class="actions">
        <button data-edit="${esc(p.id)}">
          Editar
        </button>

        <button data-toggle="${esc(p.id)}">
          ${p.active === false ? "Activar" : "Ocultar"}
        </button>
      </div>
    </div>
  `).join("");

  $("adminProducts").querySelectorAll("[data-edit]")
    .forEach(boton => {
      boton.onclick = () => editarProducto(boton.dataset.edit);
    });

  $("adminProducts").querySelectorAll("[data-toggle]")
    .forEach(boton => {
      boton.onclick = () => cambiarVisibilidad(
        boton.dataset.toggle
      );
    });
}

// ==========================================
// ADMINISTRADOR: AGREGAR PRODUCTOS
// ==========================================

async function agregarProducto(evento) {
  evento.preventDefault();

  const formulario = evento.currentTarget;
  const datos = new FormData(formulario);

  try {
    await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: datos.get("name"),
        price: Number(datos.get("price")),
        category: datos.get("category"),
        emoji: datos.get("emoji")
      })
    });

    formulario.reset();
    mensaje("Producto agregado correctamente.");

    await actualizar();

  } catch (error) {
    mensaje(error.message);
  }
}

// ==========================================
// ADMINISTRADOR: EDITAR PRODUCTOS
// ==========================================

async function editarProducto(id) {
  const producto = db.products.find(p => p.id === id);

  if (!producto) return;

  const nombre = prompt(
    "Nombre del producto:",
    producto.name
  );

  if (nombre === null) return;

  const textoPrecio = prompt(
    "Precio del producto:",
    producto.price
  );

  if (textoPrecio === null) return;

  if (!textoPrecio.trim()) {
    mensaje("El precio no puede estar vacío.");
    return;
  }

  const precio = Number(textoPrecio);

  try {
    await api(
      "/api/products/" + encodeURIComponent(id),
      {
        method: "PATCH",
        body: JSON.stringify({
          name: nombre,
          price: precio
        })
      }
    );

    await actualizar();

    mensaje("Producto actualizado.");

  } catch (error) {
    mensaje(error.message);
  }
}

// ACTIVAR U OCULTAR PRODUCTO
async function cambiarVisibilidad(id) {
  const producto = db.products.find(p => p.id === id);

  if (!producto) return;

  try {
    await api(
      "/api/products/" + encodeURIComponent(id),
      {
        method: "PATCH",
        body: JSON.stringify({
          active: producto.active === false
        })
      }
    );

    await actualizar();

    mensaje("Disponibilidad actualizada.");

  } catch (error) {
    mensaje(error.message);
  }
}

// ==========================================
// EXPORTAR VENTAS A EXCEL
// ==========================================

function exportarVentas() {
  const filas = [
    [
      "Folio", "Fecha", "Cliente", "Estado",
      "Método", "Total", "Productos"
    ],
    ...db.orders.map(p => [
      p.folio,
      p.createdAt,
      p.customer,
      p.status,
      p.paymentMethod,
      p.total,
      p.items.map(item =>
        item.qty + "x " + item.name
      ).join("; ")
    ])
  ];

  const csv = "\uFEFF" + filas.map(fila =>
    fila.map(valor =>
      '"' +
      String(valor ?? "").replace(/"/g, '""') +
      '"'
    ).join(",")
  ).join("\r\n");

  const archivo = new Blob([csv], {
    type: "text/csv;charset=utf-8"
  });

  const enlace = document.createElement("a");
  const url = URL.createObjectURL(archivo);

  enlace.href = url;
  enlace.download = "ventas-dulce-rosa.csv";
  enlace.click();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ==========================================
// EVENTOS DE CADA PANTALLA
// ==========================================

if (pagina === "caja") {
  $("search").oninput = evento => {
    busqueda = evento.target.value;
    mostrarCaja();
  };

  $("method").onchange = () => {
    $("cashFields").hidden =
      $("method").value !== "Efectivo";
  };

  $("received").oninput = calcularCambio;
  $("checkout").onclick = cobrar;
}

if (pagina === "admin") {
  $("productForm").onsubmit = agregarProducto;
  $("export").onclick = exportarVentas;
}

// INICIAR CONEXIÓN
actualizar().then(escucharCambios);

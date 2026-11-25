
import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./styles.css";

// Localiza o elemento principal definido no index.html.
const rootElement = document.getElementById("root");

// Impede a inicialização caso o elemento HTML não exista.
if (!rootElement) {
  throw new Error(
    'Elemento HTML com id "root" não encontrado. Verifique o index.html.'
  );
}

// Inicializa a aplicação React.
const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
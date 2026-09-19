#!/usr/bin/env bash
# Funciones compartidas por todos los scripts de demo.
# Evitamos depender de 'jq' para que corra en cualquier maquina.

BASE="${BASE:-http://localhost:8080}"

# Extrae un campo string de un JSON plano. Uso: echo "$json" | campo token
campo() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*"[[:space:]]*:[[:space:]]*"//; s/"$//'
}

# Extrae un campo numerico. Uso: echo "$json" | numero posicion
numero() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | grep -o '[0-9]*$'
}

# Hace login y devuelve el token.
login() {
  curl -s -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | campo token
}

titulo() { echo; echo "=============================================================="; echo " $1"; echo "=============================================================="; }
paso()   { echo; echo "--> $1"; }
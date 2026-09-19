# TFU UT3 - Red de clinicas de atencion primaria

Demo de arquitectura: componentes e interfaces, escalabilidad horizontal,
contenedores, ACID + BASE y servicios sin estado.

## Como levantar

    docker compose up -d --build
    docker compose ps

Todo se accede por el gateway: http://localhost:8080

## Usuarios de prueba

| Email                | Password   | Rol           |
|----------------------|------------|---------------|
| ana@paciente.uy      | ana123     | paciente      |
| beto@paciente.uy     | beto123    | paciente      |
| lucia@clinica.uy     | lucia123   | medico        |
| martin@clinica.uy    | martin123  | medico        |
| farma@clinica.uy     | farma123   | farmaceutico  |
| admin@clinica.uy     | admin123   | admin         |

## Demos (en este orden)

    chmod +x scripts/*.sh
    ./scripts/00-smoke.sh            # todo arriba
    ./scripts/01-flujo-completo.sh   # componentes e interfaces
    ./scripts/02-sin-estado.sh       # servicios sin estado
    ./scripts/03-escalabilidad.sh    # escalabilidad horizontal
    ./scripts/04-acid.sh             # transacciones ACID
    ./scripts/05-base.sh             # consistencia eventual (BASE)
    ./scripts/06-notificaciones.sh   # pub/sub entre componentes

## Escalar a mano

    docker compose up -d --scale queue=3

## Ejemplo con curl

    TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"email":"ana@paciente.uy","password":"ana123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

    curl -s http://localhost:8080/api/queue/farmacia -H "Authorization: Bearer $TOKEN"

## Endpoints

### auth-service
- POST /api/auth/login
- GET  /api/auth/yo
- GET  /api/auth/usuarios (admin)

### scheduling-service
- GET  /api/scheduling/especialidades
- GET  /api/scheduling/medicos?especialidad=
- GET  /api/scheduling/slots?medico=&fecha=
- POST /api/scheduling/citas            (paciente)
- GET  /api/scheduling/citas/mias       (paciente)
- GET  /api/scheduling/citas/agenda     (medico)
- POST /api/scheduling/citas/:id/iniciar (medico)

### records-service
- GET  /api/records/pacientes/:id/historia
- POST /api/records/pacientes/:id/entradas (medico)
- POST /api/records/recetas               (medico)
- GET  /api/records/recetas/mias          (paciente)
- GET  /api/records/auditoria             (admin)

### pharmacy-service
- POST /api/pharmacy/retiros              (paciente)
- GET  /api/pharmacy/retiros/mios         (paciente)
- GET  /api/pharmacy/retiros/pendientes   (farmaceutico)

### queue-service
- GET  /api/queue/farmacia
- GET  /api/queue/mi-turno                (paciente)
- POST /api/queue/farmacia/presencial     (farmaceutico)
- POST /api/queue/farmacia/siguiente      (farmaceutico)

### notifications-service
- GET  /api/notifications/mias            (paciente)
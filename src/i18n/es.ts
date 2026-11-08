import type { en } from "./en";

export const es: Record<keyof typeof en, string> = {
  "app.title": "Lilthop",
  "language.en": "English",
  "language.es": "Español",

  "nav.practice": "Practicar",
  "nav.label": "Principal",
  "nav.locked": "Se abren después del paso de seguridad.",
  "nav.home": "Inicio",
  "nav.progress": "Progreso",
  "nav.recordings": "Grabaciones",
  "nav.settings": "Ajustes",

  "onboarding.welcome": "Te damos la bienvenida a Lilthop",
  "onboarding.intro":
    "Esta app es para mujeres trans y personas transfemeninas que buscan una voz más aguda y femenina. Practica a tu ritmo, hacia el sonido que quieres.",
  "onboarding.baselineTitle": "Mide tu tono de partida",
  "onboarding.baselineHelp":
    "Activa el micrófono y habla como lo haces normalmente durante unos 10 segundos.",
  "onboarding.voicedSeconds": "Tiempo con voz: {seconds} s",
  "onboarding.finishBaseline": "Terminar la medición",
  "onboarding.targetTitle": "Define tu rango",
  "onboarding.saveContinue": "Guardar y continuar",
  "common.target": "Tu rango",
  "common.minHz": "Mín Hz",
  "common.maxHz": "Máx Hz",
  "common.goals": "Metas de enfoque",
  "common.save": "Guardar",
  "common.stop": "Parar",
  "common.delete": "Eliminar",
  "common.play": "Reproducir",
  "common.default": "Predeterminado",

  "home.noGoals": "Define tus metas en Ajustes.",
  "home.startMic": "Activar micrófono",
  "home.stopMic": "Apagar micrófono",

  "rail.routineToday": "Rutina de hoy",
  "rail.routineTonight": "Rutina de esta noche",
  "rail.done": "Hecho",
  "mic.starting": "Activando el micrófono…",
  "alert.dismiss": "Cerrar",
  "home.greetingMorning": "Buenos días.",
  "home.greetingAfternoon": "Buenas tardes.",
  "home.greetingEvening": "Buenas noches.",
  "home.startExercise": "Empezar {name}",
  "home.planDone": "Esa es la rutina de hoy. Si quieres más, tú decides.",
  "home.openPractice": "Elegir un ejercicio",
  "home.duration": "unos {minutes} min",
  "trace.pitchLabel":
    "Trazo del tono de los últimos 8 segundos. Tu rango va de {min} a {max} Hz.",
  "trace.pitchLabelNoBand": "Trazo del tono de los últimos 8 segundos.",
  "trace.levelLabel": "Trazo del volumen de los últimos 8 segundos.",
  "reading.pitch": "Tono",
  "reading.aboveBand": "Por encima de tu rango",
  "reading.belowBand": "Por debajo de tu rango",
  "reading.hearingYou": "Te escucho",
  "exercise.pick": "Ejercicio",
  "exercise.again": "Otra vez",
  "exercise.needsRange":
    "Define primero tu rango para tener con qué practicar.",
  "metronome.label": "Metrónomo",
  "metronome.tempo": "Tempo, pulsos por minuto",
  "result.average": "Tono medio {mean} Hz",
  "result.savedNote": "Resultado guardado.",
  "result.saving": "Guardando…",
  "result.saveFailed": "No se pudo guardar este resultado. {reason}",
  "result.retrySave": "Intentar guardar otra vez",
  "result.oneTake":
    "Esto es una sola toma. Habla de esta sesión, no de cómo es tu voz.",
  "error.retry": "Reintentar",
  "load.title": "No se pudo leer tu perfil",
  "load.body":
    "No se cambió nada. Inténtalo de nuevo y, si sigue pasando, cierra la app y vuelve a abrirla.",
  "load.stillFailed": "Sigue sin poder leerse.",
  "load.moveTitle": "Tus datos anteriores aún no se han movido",
  "load.moveStillFailed":
    "Sigue sin poder moverse. Tus datos siguen intactos donde estaban.",
  "load.startFresh": "Empezar de cero",
  "load.startFreshNote":
    "Tus datos anteriores se quedan en su carpeta antigua y Lilthop empieza vacío.",
  "load.startFreshConfirmTitle": "¿Empezar de cero sin tus datos anteriores?",
  "load.startFreshConfirmBody":
    "Tus datos anteriores se quedan en su carpeta antigua y Lilthop no volverá a intentar moverlos. «Eliminar todos los datos» en Ajustes también los eliminaría. Mientras no guardes nada nuevo, Ajustes aún puede moverlos.",
  "load.startFreshAction": "Empezar de cero",
  "load.startFreshFailed": "No se pudo empezar de cero. No se cambió nada.",

  "reading.inBand": "Dentro de tu rango",
  "reading.listening": "Escuchando…",
  "reading.micOff": "El micrófono está apagado",
  "reading.level": "Volumen",
  "reading.brightness": "Brillo (guía aproximada)",

  "exercise.startSession": "Empezar",
  "exercise.timeLeft": "Tiempo restante: {seconds} s",
  "exercise.finishSave": "Terminar y guardar",

  "result.notEnoughVoice":
    "No hubo suficiente voz para puntuar este ejercicio ({seconds} s de voz). No se guardó nada. Inténtalo de nuevo.",
  "result.notEnoughSound":
    "No hubo suficiente sonido para puntuar este ejercicio ({seconds} s). No se guardó nada. Inténtalo de nuevo.",
  "result.practiceOnly":
    "Buena práctica. El brillo es solo una pista aproximada, así que este ejercicio no tiene puntuación. Brillo mediano: {hz} Hz.",

  "measure.steady.label": "Estabilidad",
  "measure.sustained.label": "Tiempo en tu rango y estabilidad",
  "measure.range.label": "Tiempo en tu rango",
  "measure.raise.label": "Tiempo en la mitad superior de tu rango",
  "measure.glide.label": "Amplitud y suavidad de tus deslizamientos",
  "measure.mixed.label": "Deslizamientos suaves por tu cambio de registro",
  "measure.intonation.label": "Movimiento del tono en tus frases",
  "measure.breath.label": "Sonido constante a lo largo del tiempo",
  "measure.brightness.label": "Brillo, una pista aproximada (sin puntuación)",
  "measure.articulation.label": "Estabilidad del tono",

  "progress.title": "Progreso",
  "progress.totalSessions": "Sesiones totales: {count}",
  "progress.totalTime": "Tiempo total de práctica: {minutes} min",
  "progress.practiceDays":
    "Días que practicaste en los últimos {days}: {count}",
  "progress.trendUp": "Puntuaciones más altas últimamente",
  "progress.trendDown": "Más bajo últimamente. Hay días así.",
  "progress.trendFlat": "Más o menos igual últimamente",
  "progress.trendUnknown": "Aún hay pocas sesiones",

  "data.exportJson": "Exportar JSON",
  "data.exportCsv": "Exportar CSV",
  "data.backup": "Crear una copia de seguridad",
  "data.restore": "Restaurar una copia de seguridad",
  "data.deleteAll": "Eliminar todos los datos",
  "data.restored":
    "Se restauraron {results} resultados y {recordings} grabaciones.",

  "recordings.title": "Grabaciones",
  "recordings.none": "Aún no hay grabaciones.",
  "recordings.search": "Buscar grabaciones",
  "recordings.note": "Nota",
  "recordings.tags": "Etiquetas",
  "recordings.stopPlayback": "Detener reproducción",

  "settings.title": "Ajustes",
  "settings.theme": "Tema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Oscuro",
  "settings.language": "Idioma",
  "settings.inputDevice": "Dispositivo de entrada",
  "settings.calibrate": "Calibrar",
  "settings.collectMore": "Sigue un poco más, todavía no hay suficiente voz.",
  "settings.deviceFellBack":
    "No se encontró ese dispositivo, así que se usa el predeterminado.",

  "error.title": "Algo salió mal",
  "error.details": "Detalles técnicos",
  "error.unknown": "Algo salió mal. Inténtalo de nuevo.",
  "error.invalid_input": "Ese valor no es válido.",
  "error.not_found": "No se encontró ese elemento.",
  "error.io": "No se pudo leer o escribir un archivo.",
  "error.database": "No se pudieron leer o guardar los datos.",
  "error.invalid_backup":
    "No se pudo usar esa copia de seguridad. No se cambió nada.",
  "error.device_lost":
    "El micrófono se desconectó. Vuelve a conectarlo e inténtalo de nuevo.",
  "error.migration_failed":
    "Todavía no se pudieron mover tus datos anteriores a la nueva carpeta de Lilthop. No se perdió nada: siguen intactos donde estaban, en su carpeta anterior (com.voice.trainer o voice-trainer), junto a esta. Inténtalo de nuevo.",
  "error.write_failed":
    "No se pudo guardar la grabación en el disco. Comprueba que haya espacio libre.",
  "error.audio_lost": "Se perdió parte del audio de esta grabación.",
  "error.stream_failed":
    "No se pudo activar el micrófono. Comprueba que esté conectado y que tenga permiso en los ajustes del sistema.",

  "goal.pitch": "Subir tu tono al hablar",
  "goal.stability": "Tono estable y constante",
  "goal.resonance": "Explorar la resonancia hacia delante",
  "goal.range": "Deslizamientos suaves y cómodos",
  "goal.intonation": "Explorar la entonación",
  "goal.endurance": "Apoyo respiratorio cómodo",

  "category.warmup": "Calentamiento",
  "category.pitch": "Tono",
  "category.resonance": "Resonancia",
  "category.range": "Rango",
  "category.register": "Registro",
  "category.intonation": "Entonación",
  "category.articulation": "Articulación",
  "category.breath": "Respiración",
  "notice.clipping":
    "El micrófono está recibiendo más sonido del que puede manejar, así que el audio se distorsiona y las lecturas no son fiables. Prueba a alejarte un poco o a bajar el volumen de entrada.",
  "notice.louder":
    "Hablas más fuerte que al empezar. Más volumen puede subir el tono: prueba el mismo tono con un volumen cómodo. Solo se compara con el inicio de esta sesión, en este micrófono.",
  "notice.aboveRange":
    "Tu tono lleva un rato por encima de tu rango. No pasa nada si te resulta fácil. Si no, baja un poco o haz una pausa.",
  "notice.pitchJump":
    "Salto de tono grande hace un momento. No pasa nada si fue a propósito.",
  "nav.skip": "Saltar al contenido principal",
  "common.back": "Atrás",
  "common.next": "Siguiente",
  "common.skip": "Saltar",
  "common.cancel": "Cancelar",
  "onboarding.stepOf": "Paso {step} de {total}",
  "onboarding.micTitle": "Prueba tu micrófono",
  "onboarding.micHelp":
    "Elige tu micrófono, actívalo y di algo. El sonido se queda en este equipo.",
  "onboarding.micSkip":
    "¿Ahora no tienes micrófono? No pasa nada. Salta este paso y configúralo luego en Ajustes.",
  "onboarding.passage":
    "La tarde está tranquila y no tengo prisa. Tomo aire y hablo como hablo en un día cualquiera. No hay una forma buena de leer esto, así que sigo sin más.",
  "onboarding.rangeHelp":
    "Empieza un poco por encima de lo que se midió y deja margen para subir con calma. Muévelo a donde quieras.",
  "onboarding.rangeHelpAround":
    "Queda alrededor de lo que se midió, con algo más de margen por encima que por debajo. Muévelo a donde quieras.",
  "onboarding.rangeHelpEmpty":
    "No se midió nada, y no pasa nada. Escribe un rango si ya tienes uno, o salta este paso y ponlo luego en Ajustes.",
  "onboarding.goalsHelp":
    "Elige en qué te apetece trabajar. Puedes cambiarlo cuando quieras.",
  "range.invalid":
    "El mínimo tiene que estar por debajo del máximo, y los dos entre 40 y 2000 Hz.",
  "range.sourcesTitle": "De dónde salen estas cifras",
  "range.sources":
    "Los estudios sobre cómo se perciben las voces sitúan una media que suena femenina entre 180 y 220 Hz, más o menos, y una zona ambigua entre 145 y 175 Hz. No coinciden en un mínimo: las propuestas van de 155 a 180 Hz. El tono es solo una parte, y hay voces que se perciben como de mujer con tonos muy distintos. Casi toda esta investigación se hizo con hablantes de inglés. El rango sugerido empieza un poco por encima de tu tono medido y no sube su borde inferior más allá de 175 Hz.",
  "calibration.start": "Empezar a medir",
  "calibration.again": "Medir otra vez",
  "calibration.measuredTitle": "Lo que midió la app",
  "calibration.pitch": "Tono habitual",
  "calibration.brightness": "Brillo",
  "calibration.level": "Nivel",
  "recalibrate.invite":
    "Tu tono de partida viene de la primera versión de esta app, que leía las voces un poco altas. ¿Quieres medirlo otra vez? Son unos 10 segundos.",
  "recalibrate.notNow": "Ahora no",
  "recalibrate.save": "Guardar estas cifras",
  "recalibrate.saved":
    "Guardado. Tu rango sigue igual, y puedes cambiarlo en Ajustes.",
  "recalibrate.suggested":
    "Con esta medición, el rango sugerido va de {min} a {max} Hz. Tu rango solo cambia si lo eliges.",
  "recalibrate.useSuggested": "Usar este rango",
  "recalibrate.backToSettings": "Volver a Ajustes",
  "progress.exercise": "Ejercicio",
  "progress.legendCurrent": "Medido ahora",
  "progress.legendOld": "Medido a la antigua",
  "progress.legendUnscored": "Práctica sin puntuación",
  "progress.chartLabel": "{name}: {count} sesiones. {trend}",
  "progress.tableSummary": "Ver estas sesiones en una tabla",
  "progress.tableDate": "Fecha",
  "progress.tableResult": "Resultado",
  "progress.tableMeasured": "Medición",
  "progress.noScore": "sin puntuación",
  "progress.scoreValue": "{score} %",
  "progress.empty":
    "Aún no hay sesiones. La primera aparecerá aquí, y su luna también.",
  "progress.monthLabel": "{month}: practicaste {count} días",
  "progress.oldNote":
    "Las sesiones medidas a la antigua se quedan aquí, pero nunca cuentan para las tendencias.",
  "recordings.record": "Grabar",
  "recordings.stopRecording": "Parar la grabación",
  "recordings.recording": "Grabando…",
  "recordings.noneHelp":
    "Graba unos segundos y escúchalos para oír cómo suenas hoy.",
  "recordings.noMatch": "Nada coincide con esa búsqueda.",
  "recordings.length": "Dura {seconds} s",
  "recordings.playOne": "Reproducir la grabación del {date}",
  "recordings.stopOne": "Parar la grabación del {date}",
  "recordings.noteFor": "Nota del {date}",
  "recordings.tagsFor": "Etiquetas del {date}",
  "recordings.deleteOne": "Borrar la grabación del {date}",
  "recordings.saving": "Guardando…",
  "recordings.saved": "Nota guardada",
  "recordings.saveFailed": "No se guardó: {reason}",
  "recordings.confirmTitle": "¿Borrar esta grabación?",
  "recordings.confirmBody":
    "La grabación del {date} se borrará para siempre. No se puede deshacer.",
  "recordings.deleted": "Grabación borrada.",
  "settings.preferences": "Preferencias",
  "settings.yourData": "Tus datos",
  "settings.rangeSaved": "Rango guardado.",
  "settings.goalsSaved": "Metas guardadas.",
  "settings.saveGoals": "Guardar metas",
  "settings.recalibrateHelp":
    "Vuelve a medir tu tono de partida. Son unos 10 segundos.",
  "settings.privacy":
    "Nada sale de este equipo. Sin cuenta y sin rastreo: tu voz, tus grabaciones y tus resultados se quedan aquí.",
  "settings.readSafety": "Leer sobre tu voz y la seguridad",
  "data.exported": "Guardado como {name}.",
  "data.backedUp": "Copia guardada como {name}.",
  "data.cancelled": "Cancelado. No cambió nada.",
  "data.restoredProfile":
    "Se restauraron {results} resultados, {recordings} grabaciones y tus ajustes.",
  "data.confirmTitle": "¿Borrar todos tus datos?",
  "data.confirmBody":
    "Esto borra tus sesiones, grabaciones y ajustes de este equipo. También elimina las copias de tus datos que dejaron las versiones anteriores de esta app, si siguen ahí. No se puede deshacer.",
  "data.confirmAction": "Borrar todo",
  "error.earlier_data_unchecked":
    "Algunos datos anteriores no se pudieron comprobar y se dejaron donde estaban.",
  "data.moveEarlier": "Mover de nuevo mis datos anteriores",
  "data.movedEarlier": "Tus datos anteriores se movieron.",
  "data.deleted": "Todos tus datos están borrados.",
  "result.moonCaption": "{done} de {total} en la rutina de hoy",
};

// Управление окном.
// Полоса заголовка теперь НАТИВНАЯ (рисуется Windows, см. _install_native_titlebar в app.py) —
// ради Aero Snap: пока браузер накрывал окно целиком, система не видела перетаскивания.
// Отсюда и проверки: в разметке титлбара быть не должно, а закрытие обязано идти через
// appRequestClose, иначе окно рвётся раньше, чем правка доедет до диска.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));

t.push({имя:"HTML-титлбара нет (полоса нативная)", ок: !document.querySelector("#titlebar"),
        факт: document.querySelector("#titlebar") ? "элемент остался" : ""});
t.push({имя:"кнопок окна в разметке нет", ок: !document.querySelector(".winbtns"), факт:""});
t.push({имя:"вёрстка не сдвинута", ок: !!document.querySelector("#topbar") && !!document.querySelector("#body"),
        факт:"topbar и body на месте"});

// закрытие: сначала сохранение, потом win_close — иначе теряется последнее действие
const журнал = [];
const прежний = window.pywebview;
window.pywebview = {api: {
  load: async () => null,
  save: async (s) => { журнал.push("save"); return true; },
  win_close: () => { журнал.push("win_close"); return true; },
  set_titlebar_theme: (d) => { журнал.push("тема:" + (d ? "тёмная" : "светлая")); return true; },
}};

t.push({имя:"appRequestClose существует", ок: typeof window.appRequestClose === "function", факт:""});
if (typeof window.appRequestClose === "function"){
  addItem({kind:"task", title:"Мысль перед закрытием"});
  await window.appRequestClose();
  await ж(120);
  const п = журнал.join(" → ");
  t.push({имя:"закрытие сохраняет ДО того, как рвёт окно",
          ок: /save\s*→\s*win_close/.test(п), факт: п || "ничего не произошло"});
  const мусор = S.items.find(i => i.title === "Мысль перед закрытием");
  if (мусор) hardDeleteItem(мусор.id);
}

// тема: нативная полоса про CSS не знает, ей сообщают отдельно
журнал.length = 0;
const былаТема = S.settings.theme;
S.settings.theme = "light"; applySettings(); await ж(40);
t.push({имя:"светлая тема доходит до нативной полосы", ок: журнал.includes("тема:светлая"), факт: журнал.join(",")});
журнал.length = 0;
S.settings.theme = "dark"; applySettings(); await ж(40);
t.push({имя:"тёмная тема доходит до нативной полосы", ок: журнал.includes("тема:тёмная"), факт: журнал.join(",")});
S.settings.theme = былаТема; applySettings();

/* ПЛАШКА ОБНОВЛЕНИЯ. Раньше про новую версию говорил тост: он жил пять секунд и стирался
   следующим сообщением, так что отошедший от компьютера человек про обновление не узнавал
   вовсе. Плашка обязана висеть, пока не обновятся или не закроют её руками. */
{
  document.querySelectorAll("#upd-banner").forEach(n=>n.remove());
  журнал.length = 0;
  // заглушка отвечает НЕ мгновенно: в жизни это качается ~20 МБ, и ход должен быть виден
  window.pywebview.api.apply_update = async (a) => { журнал.push("apply:"+a); await ж(400); return {ok:false, error:"download"}; };

  showUpdateBanner("9.9.9.9", "https://пример/сборка.zip");
  await ж(120);
  const пл = () => document.querySelector("#upd-banner");
  t.push({имя:"плашка обновления появляется", ок: !!пл() && /9\.9\.9\.9/.test(пл().textContent),
          факт: пл() ? пл().textContent.replace(/\s+/g," ").trim() : "нет плашки"});

  /* МЕСТО ПЛАШКИ — снизу по центру. В правом нижнем углу её закрывали правая панель и лоток
     «неразобранного», а на широком окне туда просто не смотрят. Проверяем заодно, что она не
     садится на тост: тот живёт у самого низа и появляется в любой момент. */
  {
    const r = пл().getBoundingClientRect();
    const тост = document.querySelector("#toast");
    const rt = тост ? тост.getBoundingClientRect() : null;
    t.push({имя:"плашка обновления стоит снизу по центру",
            ок: Math.abs((r.left + r.width/2) - innerWidth/2) < 4 && innerHeight - r.bottom < 120 && r.top > innerHeight/2,
            факт:"центр по X "+Math.round(r.left+r.width/2)+" при центре окна "+Math.round(innerWidth/2)+
                 ", до низа окна "+Math.round(innerHeight-r.bottom)+" px"});
    t.push({имя:"плашка обновления не наезжает на тост", ок: !rt || r.bottom <= rt.top + 1,
            факт: rt ? "низ плашки "+Math.round(r.bottom)+", верх тоста "+Math.round(rt.top) : "тоста нет"});
  }

  // тосты живут 1.8–5 с и перетирают друг друга; плашка обязана пережить и их, и время
  toast("что-то произошло"); toast("и ещё раз");
  await ж(6200);
  t.push({имя:"плашка не исчезает сама и не сбивается тостами", ок: !!пл(),
          факт: пл() ? "висит через 6 секунд и два тоста" : "пропала"});

  // «Обновить» показывает ход прямо в плашке и не закрывает её при неудаче
  document.querySelector("#upd-go").click();
  await ж(60);
  const вХоде = (document.querySelector("#upd-sub")||{}).textContent||"";
  await ж(700);
  const итог = (document.querySelector("#upd-sub")||{}).textContent||"";
  const кнопка = document.querySelector("#upd-go");
  t.push({имя:"ход обновления виден в самой плашке, а ошибка её не закрывает",
          ок: !!пл() && /Скачива/.test(вХоде) && /интернет|не удалось/i.test(итог)
              && журнал.some(x=>x.indexOf("apply:")===0) && кнопка && !кнопка.disabled,
          факт: "во время: «"+вХоде+"», после: «"+итог+"», кнопка снова жмётся: "+(кнопка&&!кнопка.disabled)});

  // и только крестик её убирает
  document.querySelector("#upd-close").click();
  await ж(80);
  t.push({имя:"плашка закрывается крестиком", ок: !пл(), факт: пл()?"осталась":"закрылась"});
}

if (прежний === undefined) delete window.pywebview; else window.pywebview = прежний;
return t;

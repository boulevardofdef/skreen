/* Skreen backgrounds: soft, dark color fields with gentle contrast. No lines, no patterns,
   nothing sharp for text to fight with. One per day, or pin your favorite. */
window.Backgrounds = (() => {
  const list = [
    { id: 'ink', name: 'Ink',
      css: 'radial-gradient(120% 90% at 15% 0%, #1f1c19, #0e0d0b 65%)' },
    { id: 'dusk', name: 'Dusk',
      css: 'radial-gradient(70% 80% at 90% 5%, rgba(98,64,110,0.50), transparent 70%), radial-gradient(75% 80% at 5% 100%, rgba(26,70,86,0.55), transparent 70%), linear-gradient(160deg, #15121a, #0d0f14)' },
    { id: 'ember', name: 'Ember',
      css: 'radial-gradient(75% 85% at 0% 100%, rgba(140,60,32,0.55), transparent 70%), radial-gradient(60% 60% at 100% 0%, rgba(120,84,40,0.35), transparent 70%), linear-gradient(160deg, #17100d, #0f0b09)' },
    { id: 'lagoon', name: 'Lagoon',
      css: 'radial-gradient(80% 80% at 85% 90%, rgba(20,100,110,0.45), transparent 70%), radial-gradient(70% 70% at 10% 5%, rgba(30,50,110,0.45), transparent 70%), linear-gradient(170deg, #0b1418, #0a0d14)' },
    { id: 'moss', name: 'Moss',
      css: 'radial-gradient(85% 85% at 85% 100%, rgba(62,82,44,0.55), transparent 70%), radial-gradient(60% 60% at 5% 0%, rgba(38,66,66,0.40), transparent 70%), linear-gradient(160deg, #10130d, #0b0d0a)' },
    { id: 'wine', name: 'Wine',
      css: 'radial-gradient(75% 80% at 10% 90%, rgba(110,36,60,0.50), transparent 70%), radial-gradient(70% 75% at 95% 5%, rgba(50,44,112,0.45), transparent 70%), linear-gradient(160deg, #170d12, #0e0c13)' },
    { id: 'slate', name: 'Slate',
      css: 'radial-gradient(80% 80% at 90% 0%, rgba(60,76,100,0.50), transparent 70%), radial-gradient(60% 60% at 0% 100%, rgba(100,80,56,0.32), transparent 70%), linear-gradient(165deg, #12151a, #0c0d10)' },
    { id: 'twilight', name: 'Twilight',
      css: 'radial-gradient(60% 60% at 70% 30%, rgba(120,70,120,0.25), transparent 70%), linear-gradient(135deg, #1a1530 0%, #2a1a3a 38%, #3a1f33 62%, #14111d 100%)' },
    { id: 'sandstone', name: 'Sandstone',
      css: 'radial-gradient(80% 80% at 15% 10%, rgba(130,96,66,0.38), transparent 70%), radial-gradient(70% 70% at 90% 95%, rgba(112,60,70,0.40), transparent 70%), linear-gradient(160deg, #17120e, #100c0b)' },
  ];

  const byId = (id) => list.find((b) => b.id === id);
  const dayIndex = (d = new Date()) => {
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000);
  };
  // "auto" rotates through the list, one per day.
  const forDay = (d) => list[dayIndex(d) % list.length];

  return { list, byId, forDay };
})();

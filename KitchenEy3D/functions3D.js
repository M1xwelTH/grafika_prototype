function assignTasks3D(waiters, tables, kitchen) {
  waiters.forEach(w => {

    if (w.state === 'free') {
      const t = tables.find(tb =>
        tb.state === TABLE_STATES.OCCUPIED &&
        !tb.targeted
      );
      if (t) {
        t.targeted = true;
        w.table = t;

        const c = t.center();
        const a = Math.random() * Math.PI * 2;
        w.target = new THREE.Vector3(
          c.x + Math.cos(a) * t.size,
          w.pos.y,
          c.z + Math.sin(a) * t.size
        );

        w.state = 'toTable';
      }
    }

    if (w.state === 'toTable' && w.table &&
        w.distanceTo(w.target) < 2) {
      w.table.state = TABLE_STATES.ORDERED;
      w.table.timer = 12;
      w.target = kitchen.center();
      w.state = 'toKitchen';
    }

    if (w.state === 'toKitchen' &&
        w.distanceTo(kitchen.center()) < 3) {
      w.target = w.table.center();
      w.state = 'toDeliver';
    }

    if (w.state === 'toDeliver' && w.table &&
        w.distanceTo(w.target) < 2) {
      w.table.targeted = false;
      w.table = null;
      w.target = null;
      w.state = 'free';
    }
  });
}

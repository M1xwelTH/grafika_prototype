let foodCounter = 0;

function assignTasks(waiters, tables, kitchen) {
    waiters.forEach(w => {
        if (w.state === 'free') {
            const t = tables.find(tb => tb.state === TABLE_STATES.OCCUPIED && tb.targeted === false);
            if (t) {
            t.targeted = true;   // 🔒 lock table
            w.table = t;
            w.target = t.center();
            w.state = 'toTable';
            }
        }

        if (w.state === 'toTable' && w.table && w.distanceTo(w.table.center()) < 12) {
            w.table.state = TABLE_STATES.ORDERED;
            w.table.timer = 20;
            w.state = 'toKitchen';
            w.target = kitchen.center();
        }

        if (w.state === 'toKitchen' && w.distanceTo(kitchen.center()) < 12) {
            w.food = foodCounter++;
            w.state = 'toDeliver';
            w.target = w.table.center();
        }

        if (w.state === 'toDeliver' && w.table && w.distanceTo(w.table.center()) < 12) {
            w.food = null;
            w.table.targeted = false; // 🔓 unlock
            w.table = null;
            w.state = 'free';
            w.target = null;
        }
    });
}
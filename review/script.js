let items = [];
let selected = new Set();
// Multi-group state
let groups = null; // [{ index, items: [...] }]
let multiMode = false;
let currentGroup = 0;
let groupSelections = []; // Array<Set<number>> by group index

const $grid = $("#grid");
const $empty = $("#empty");
const $modal = $("#modal");
const $modalImg = $("#modal-img");
const $done = $("#done");

let macy; // masonry instance

function initMasonry() {
	// Destroy if already created (e.g., re-render)
	if (macy && macy.recalculate) {
		try {
			macy.remove();
		} catch {}
	}
	macy = Macy({
		container: "#grid",
		trueOrder: true,
		margin: 16,
		columns: 4, // cap at 4
		breakAt: {
			// centered because container has max-width + auto margins
			1024: 4,
			900: 3,
			640: 2,
			0: 1,
		},
	});
}

// Returns the `i` of the highest-scored item in a group
function bestIndexForGroup(group) {
    let best = null;
    let bestScore = -Infinity;
    // Accept either { items: [...] } or raw array of entries
    let arr;
    if (group && Array.isArray(group.items)) {
        arr = group.items;
    } else if (Array.isArray(group)) {
        arr = group.map((entry, i) => ({
            i,
            score:
                typeof entry?.score?.score === "number"
                    ? entry.score.score
                    : Number(entry?.score) || 0,
        }));
    } else {
        arr = [];
    }
    for (let k = 0; k < arr.length; k++) {
        const it = arr[k];
        const s = it && typeof it.score === "number" ? it.score : -Infinity;
        if (s > bestScore) {
            bestScore = s;
            best = it.i;
        }
    }
    return best;
}

function buildCard(it, recIndex) {
	const isChecked = selected.has(it.i);
  const isRecommended = typeof recIndex === "number" && it.i === recIndex;

	const imgSrc = multiMode ? `/img/${it.gi}/${it.i}` : `/img/${it.i}`;

	const $card = $(`
    <figure class="avoid-break masonry-item">
      <div class="relative overflow-hidden rounded-xl border ${isChecked ? "border-emerald-500 border-2" : "border-zinc-800"} bg-zinc-900">
        <button type="button" class="expand absolute left-2 top-2 z-10 rounded-md bg-black/55 px-2 py-1 text-xs ring-1 ring-zinc-700 hover:bg-black/70">Expand</button>

        ${
          isRecommended
            ? `
        <div class="rec-badge absolute left-2 bottom-2 z-10 flex items-center gap-1 rounded-md bg-amber-400/95 px-2 py-1 text-xs font-semibold text-black ring-1 ring-amber-300/70 shadow">
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.39 6.94H22l-5.7 4.14 2.39 6.92L12 15.86 5.31 20l2.39-6.92L2 8.94h7.61L12 2z" />
          </svg>
          <span>Recommended</span>
        </div>
        `
            : ""
        }

        <div class="check absolute right-2 top-2 z-10 ${isChecked ? "flex" : "hidden"} items-center justify-center rounded-full bg-emerald-600 p-1 ring-2 ring-emerald-400/60">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>

        <img src="${imgSrc}" alt="" class="block h-auto w-full object-cover select-none" />
        <button type="button" class="select absolute inset-0"></button>
      </div>
    </figure>
  `);

	const $wrap = $card.find("div.relative");
	const $check = $card.find(".check");

	// expand
	$card.find(".expand").on("click", (e) => {
		e.stopPropagation();
		$modalImg.attr("src", imgSrc);
		$modal.removeClass("hidden");
	});

	// select toggle (use border, not ring/box-shadow)
	$card.find(".select").on("click", () => {
		const on = !selected.has(it.i);
		if (on) {
			selected.add(it.i);
			$check.removeClass("hidden").addClass("flex");
			$wrap
				.removeClass("border-zinc-800")
				.addClass("border-emerald-500 border-2");
		} else {
			selected.delete(it.i);
			$check.addClass("hidden").removeClass("flex");
			$wrap
				.removeClass("border-emerald-500 border-2")
				.addClass("border-zinc-800");
		}
	});

	return $card;
}

function renderAll() {
	$grid.empty();
	if (!items.length) {
		$empty.removeClass("hidden");
		return;
	}
	$empty.addClass("hidden");

	// Compute the recommended index for the current view
	const recIndex = multiMode
		? bestIndexForGroup(groups[currentGroup])
		: bestIndexForGroup({ items });

	const frag = document.createDocumentFragment();
	for (const it of items) frag.appendChild(buildCard(it, recIndex)[0]);
	$grid[0].appendChild(frag);

	// (Re)initialize masonry after elements are in the DOM
	initMasonry();
	// Recalculate once images settle
	setTimeout(() => macy.recalculate(true), 50);
	// Optional: recalc after all images load
	$grid.find("img").on("load error", () => macy.recalculate(true));
}

function selectNone() {
	selected.clear();
	$grid.find(".check").addClass("hidden").removeClass("flex");
	$grid
		.find(".relative")
		.removeClass("border-emerald-500 border-2")
		.addClass("border-zinc-800");
	macy.recalculate(true);
}

function selectAll() {
	selected = new Set(items.map((x) => x.i));
	$grid.find(".check").removeClass("hidden").addClass("flex");
	$grid
		.find(".relative")
		.removeClass("border-zinc-800")
		.addClass("border-emerald-500 border-2");
	macy.recalculate(true);
}

function selectRecommended() {
	// Use the helper across modes
	const idx = multiMode
		? bestIndexForGroup(groups[currentGroup])
		: bestIndexForGroup({ items });
	const rec = new Set(idx != null ? [idx] : []);
	selected = rec;

	$grid.find("figure").each((_, fig) => {
		const i = Number($(fig).find("img").attr("src").split("/").pop());
		const on = rec.has(i);
		const $wrap = $(fig).find(".relative");
		const $check = $(fig).find(".check");
		if (on) {
			$check.removeClass("hidden").addClass("flex");
			$wrap
				.removeClass("border-zinc-800")
				.addClass("border-emerald-500 border-2");
		} else {
			$check.addClass("hidden").removeClass("flex");
			$wrap
				.removeClass("border-emerald-500 border-2")
				.addClass("border-zinc-800");
		}
	});
	macy.recalculate(true);
}

function updateHeaderControls() {
	const $gs = $("#group-status");
	const $prev = $("#prev-group");
	const $next = $("#next-group");
	const $save = $("#save");
	const $finish = $("#finish");

	if (!multiMode) {
		$gs.addClass("hidden");
		$prev.addClass("hidden");
		$next.addClass("hidden");
		$finish.addClass("hidden");
		$save.removeClass("hidden");
		return;
	}

	const total = groups.length;
	$gs.text(`Group ${currentGroup + 1} of ${total}`).removeClass("hidden");
	$prev.toggleClass("hidden", currentGroup === 0);
	$next.toggleClass("hidden", currentGroup >= total - 1);
	$save.addClass("hidden");
	$finish.toggleClass("hidden", currentGroup < total - 1 ? true : false);
}

function loadGroup(gi) {
    currentGroup = gi;
    const g = groups[gi];
    // Build items payload with group index carried through; tolerate raw arrays
    const baseItems = Array.isArray(g)
        ? g.map((entry, i) => ({
              i,
              score:
                  typeof entry?.score?.score === "number"
                      ? entry.score.score
                      : Number(entry?.score) || 0,
          }))
        : Array.isArray(g?.items)
        ? g.items
        : [];
    items = baseItems.map((it) => ({ ...it, gi }));
	// Set selected from per-group selection set
	const sel = groupSelections[gi] || new Set();
	selected = new Set(sel);
	renderAll();
	updateHeaderControls();
}

async function load() {
	try {
		const data = await $.getJSON("/api/data");
		if (Array.isArray(data.groups)) {
			groups = data.groups;
			multiMode = true;
			// Initialize selections using highest-score per group
			groupSelections = groups.map((g) => {
				const idx = bestIndexForGroup(g);
				return new Set(idx != null ? [idx] : []);
			});
			loadGroup(0);
		} else {
			items = data.items || [];
			// Single-mode: choose the overall highest-score item
			const idx = bestIndexForGroup({ items });
			selected = new Set(idx != null ? [idx] : []);
			renderAll();
			updateHeaderControls();
		}
	} catch (err) {
		console.error(err);
		$grid.empty();
		$empty.removeClass("hidden");
		alert("Failed to load photos");
	}
}

async function save() {
	const $btn = $("#save");
	const keep = Array.from(selected).sort((a, b) => a - b);

	const original = $btn.text();
	$btn
		.prop("disabled", true)
		.addClass("opacity-70 cursor-not-allowed")
		.text("Saving...");
	try {
		await $.ajax({
			url: "/api/decide",
			method: "POST",
			contentType: "application/json",
			data: JSON.stringify({ keep }),
		});
		// Success popup
		$done.removeClass("hidden");
	} catch (err) {
		console.error(err);
		// alert("Failed to save");
	} finally {
		$btn
			.prop("disabled", false)
			.removeClass("opacity-70 cursor-not-allowed")
			.text(original);
	}
}

$(() => {
	$("#select-none").on("click", selectNone);
	$("#select-all").on("click", selectAll);
	$("#select-rec").on("click", selectRecommended);
	$("#save").on("click", save);

	$("#prev-group").on("click", () => {
		if (!multiMode) return;
		// Persist current selections
		groupSelections[currentGroup] = new Set(Array.from(selected));
		if (currentGroup > 0) loadGroup(currentGroup - 1);
	});
	$("#next-group").on("click", () => {
		if (!multiMode) return;
		groupSelections[currentGroup] = new Set(Array.from(selected));
		if (currentGroup < groups.length - 1) loadGroup(currentGroup + 1);
	});
	$("#finish").on("click", async () => {
		if (!multiMode) return;
		groupSelections[currentGroup] = new Set(Array.from(selected));
		const results = groupSelections.map((set) =>
			Array.from(set).sort((a, b) => a - b),
		);

		const $btn = $("#finish");
		const original = $btn.text();
		$btn
			.prop("disabled", true)
			.addClass("opacity-70 cursor-not-allowed")
			.text("Saving...");
		try {
			await $.ajax({
				url: "/api/decide",
				method: "POST",
				contentType: "application/json",
				data: JSON.stringify({ results }),
			});
			// Success popup
			$done.removeClass("hidden");
		} catch (err) {
			console.error(err);
		} finally {
			$btn
				.prop("disabled", false)
				.removeClass("opacity-70 cursor-not-allowed")
				.text(original);
		}
	});

	$("#modal-close, #modal").on("click", (e) => {
		if (e.target.id === "modal" || e.target.id === "modal-close") {
			$modal.addClass("hidden");
			$modalImg.attr("src", "");
		}
	});

	$("#done-dismiss").on("click", () => $done.addClass("hidden"));
	$("#done-close-tab").on("click", () => {
		try {
			if (typeof window.close === "function") window.close();
		} catch {}
	});

	load();
});

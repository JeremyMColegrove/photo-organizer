let items = [];
let selected = new Set();

const $grid = $("#grid");
const $empty = $("#empty");
const $modal = $("#modal");
const $modalImg = $("#modal-img");

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

function buildCard(it) {
	const isChecked = selected.has(it.i);

	const $card = $(`
    <figure class="avoid-break masonry-item">
      <div class="relative overflow-hidden rounded-xl border ${isChecked ? "border-emerald-500 border-2" : "border-zinc-800"} bg-zinc-900">
        <button type="button" class="expand absolute left-2 top-2 z-10 rounded-md bg-black/55 px-2 py-1 text-xs ring-1 ring-zinc-700 hover:bg-black/70">Expand</button>

        <div class="check absolute right-2 top-2 z-10 ${isChecked ? "flex" : "hidden"} items-center justify-center rounded-full bg-emerald-600 p-1 ring-2 ring-emerald-400/60">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </div>

        <img src="/img/${it.i}" alt="" class="block h-auto w-full object-cover select-none" />
        <button type="button" class="select absolute inset-0"></button>
      </div>
    </figure>
  `);

	const $wrap = $card.find("div.relative");
	const $check = $card.find(".check");

	// expand
	$card.find(".expand").on("click", (e) => {
		e.stopPropagation();
		$modalImg.attr("src", `/img/${it.i}`);
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

	const frag = document.createDocumentFragment();
	for (const it of items) frag.appendChild(buildCard(it)[0]);
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
	const rec = new Set(items.filter((x) => x.recommended).map((x) => x.i));
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

async function load() {
	try {
		const data = await $.getJSON("/api/data");
		items = data.items || [];
		selected = new Set(items.filter((x) => x.recommended).map((x) => x.i));
		renderAll();
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
		// alert("Saved!");
		if (typeof window.close === "function") window.close();
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

	$("#modal-close, #modal").on("click", (e) => {
		if (e.target.id === "modal" || e.target.id === "modal-close") {
			$modal.addClass("hidden");
			$modalImg.attr("src", "");
		}
	});

	load();
});

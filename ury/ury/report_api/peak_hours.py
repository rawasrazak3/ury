import calendar
from collections import defaultdict

import frappe
from frappe.utils import add_days, date_diff, flt, getdate

from ury.ury.report_api.utils import require_manager, validate_date_range

# Meal-time slots by hour of day. Supper wraps past midnight, so late-night
# bills (e.g. 00:30) count as supper rather than a separate "early morning".
SLOTS = [
	{"key": "breakfast", "label": "Breakfast", "start_hour": 6, "end_hour": 11},
	{"key": "lunch", "label": "Lunch", "start_hour": 11, "end_hour": 16},
	{"key": "snacks", "label": "Evening Snacks", "start_hour": 16, "end_hour": 19},
	{"key": "supper", "label": "Supper", "start_hour": 19, "end_hour": 6},
]
SLOT_KEYS = [s["key"] for s in SLOTS]


def _hour_label(hour):
	"""12-hour clock label for a 0-23 hour, e.g. 0 -> '12 AM', 14 -> '2 PM'."""
	hour = hour % 24
	return f"{hour % 12 or 12} {'AM' if hour < 12 else 'PM'}"


def _slot_for_hour(hour):
	for slot in SLOTS:
		start, end = slot["start_hour"], slot["end_hour"]
		if (start < end and start <= hour < end) or (start > end and (hour >= start or hour < end)):
			return slot["key"]
	return SLOT_KEYS[-1]


def _hour_of(posting_time):
	# frappe.db.sql returns Time columns as datetime.timedelta.
	if hasattr(posting_time, "total_seconds"):
		return int(posting_time.total_seconds() // 3600) % 24
	return int(str(posting_time).split(":")[0]) % 24


def _slot_defs():
	return [
		{**s, "range_label": f"{_hour_label(s['start_hour'])} - {_hour_label(s['end_hour'])}"}
		for s in SLOTS
	]


def _get_invoices(start_date, end_date, branch=None):
	params = {"start_date": start_date, "end_date": end_date}
	branch_filter = ""
	if branch:
		params["branch"] = branch
		branch_filter = "AND `branch` = %(branch)s"

	return frappe.db.sql(
		f"""
		SELECT `name`, `posting_date`, `posting_time`, `grand_total`, `total_qty`, `order_type`
		FROM `tabPOS Invoice`
		WHERE `posting_date` BETWEEN %(start_date)s AND %(end_date)s
			{branch_filter}
			AND `docstatus` = 1
			AND `status` IN ("Consolidated", "Paid")
		""",
		params,
		as_dict=True,
	)


def _get_invoice_items(invoice_names):
	if not invoice_names:
		return []
	return frappe.db.sql(
		"""
		SELECT `parent`, `item_code`, `item_name`, `custom_course` AS course, `qty`, `amount`
		FROM `tabPOS Invoice Item`
		WHERE `parenttype` = 'POS Invoice' AND `parent` IN %(names)s
		""",
		{"names": invoice_names},
		as_dict=True,
	)


def _aggregate_items(invoices, items, slot=None):
	"""Per-item qty/amount/bill counts, with qty split by slot."""
	invoice_slot = {inv.name: _slot_for_hour(_hour_of(inv.posting_time)) for inv in invoices}
	invoice_date = {inv.name: inv.posting_date for inv in invoices}
	agg = {}
	for row in items:
		row_slot = invoice_slot[row.parent]
		if slot and row_slot != slot:
			continue
		entry = agg.get(row.item_code)
		if not entry:
			entry = agg[row.item_code] = {
				"item_code": row.item_code,
				"item_name": row.item_name,
				"course": row.course,
				"qty": 0.0,
				"amount": 0.0,
				"bills": set(),
				"last_sold": None,
				**{key: 0.0 for key in SLOT_KEYS},
				**{key + "_amount": 0.0 for key in SLOT_KEYS},
			}
		entry["qty"] += flt(row.qty)
		entry["amount"] += flt(row.amount)
		entry[row_slot] += flt(row.qty)
		entry[row_slot + "_amount"] += flt(row.amount)
		entry["bills"].add(row.parent)
		entry["course"] = entry["course"] or row.course
		sold_on = invoice_date[row.parent]
		if not entry["last_sold"] or sold_on > entry["last_sold"]:
			entry["last_sold"] = sold_on

	for entry in agg.values():
		entry["bills"] = len(entry["bills"])
		entry["amount"] = round(entry["amount"], 2)
		for key in SLOT_KEYS:
			entry[key + "_amount"] = round(entry[key + "_amount"], 2)
		entry["last_sold"] = str(entry["last_sold"]) if entry["last_sold"] else None
	return agg


@frappe.whitelist()
def get_peak_hour_sales(start_date, end_date, branch=None):
	"""Sales by meal-time slot and hour, with the busiest weekdays, the daily
	slot trend, order types, and the fastest-moving items per slot."""
	require_manager()
	validate_date_range(start_date, end_date)
	start_date, end_date = getdate(start_date), getdate(end_date)

	invoices = _get_invoices(start_date, end_date, branch)
	items = _get_invoice_items([inv.name for inv in invoices])
	days = date_diff(end_date, start_date) + 1

	slot_totals = {key: {"sales": 0.0, "bills": 0, "qty": 0.0} for key in SLOT_KEYS}
	hourly = [{"sales": 0.0, "bills": 0} for _ in range(24)]
	daily = defaultdict(lambda: {key: 0.0 for key in SLOT_KEYS})
	weekday_sales = defaultdict(lambda: {key: 0.0 for key in SLOT_KEYS})
	order_types = defaultdict(lambda: {"bills": 0, "sales": 0.0})

	for inv in invoices:
		hour = _hour_of(inv.posting_time)
		slot = _slot_for_hour(hour)
		sales = flt(inv.grand_total)
		slot_totals[slot]["sales"] += sales
		slot_totals[slot]["bills"] += 1
		slot_totals[slot]["qty"] += flt(inv.total_qty)
		hourly[hour]["sales"] += sales
		hourly[hour]["bills"] += 1
		daily[inv.posting_date][slot] += sales
		weekday_sales[inv.posting_date.weekday()][slot] += sales
		order_type = inv.order_type or "Other"
		order_types[order_type]["bills"] += 1
		order_types[order_type]["sales"] += sales

	total_sales = round(sum(s["sales"] for s in slot_totals.values()), 2)
	total_bills = sum(s["bills"] for s in slot_totals.values())
	total_qty = sum(s["qty"] for s in slot_totals.values())

	item_agg = _aggregate_items(invoices, items)
	ranked = sorted(item_agg.values(), key=lambda r: (-r["qty"], -r["amount"]))

	slots = []
	for slot in _slot_defs():
		t = slot_totals[slot["key"]]
		top = max(item_agg.values(), key=lambda r: r[slot["key"]], default=None)
		top_earner = max(item_agg.values(), key=lambda r: r[slot["key"] + "_amount"], default=None)
		slots.append(
			{
				**slot,
				"sales": round(t["sales"], 2),
				"bills": t["bills"],
				"qty": t["qty"],
				"avg_bill": round(t["sales"] / t["bills"], 2) if t["bills"] else 0,
				"pct_sales": round(t["sales"] / total_sales * 100, 1) if total_sales else 0,
				"avg_daily_sales": round(t["sales"] / days, 2),
				"top_item": top["item_name"] if top and top[slot["key"]] else None,
				"top_earner": top_earner["item_name"] if top_earner and top_earner[slot["key"] + "_amount"] else None,
			}
		)

	hourly_rows = [
		{
			"hour": h,
			"label": _hour_label(h),
			"slot": _slot_for_hour(h),
			"sales": round(hourly[h]["sales"], 2),
			"bills": hourly[h]["bills"],
			"avg_daily_sales": round(hourly[h]["sales"] / days, 2),
		}
		for h in range(24)
	]

	daily_rows = []
	for i in range(days):
		day = add_days(start_date, i)
		row = {"date": str(day), "label": day.strftime("%d %b"), **{k: round(v, 2) for k, v in daily[day].items()}}
		row["total"] = round(sum(daily[day].values()), 2)
		daily_rows.append(row)

	# Average sales per occurrence of each weekday in the range.
	weekday_counts = defaultdict(int)
	for i in range(days):
		weekday_counts[add_days(start_date, i).weekday()] += 1
	weekday_rows = []
	for wd in range(7):
		count = weekday_counts[wd]
		row = {"weekday": calendar.day_name[wd], "days": count}
		for key in SLOT_KEYS:
			row[key] = round(weekday_sales[wd][key] / count, 2) if count else 0
		row["total"] = round(sum(row[key] for key in SLOT_KEYS), 2)
		weekday_rows.append(row)

	top_by_slot = {}
	for key in SLOT_KEYS:
		by_qty = sorted((r for r in item_agg.values() if r[key]), key=lambda r: -r[key])[:5]
		by_sales = sorted((r for r in item_agg.values() if r[key]), key=lambda r: -r[key + "_amount"])[:5]
		top_by_slot[key] = {
			"by_qty": [{"item_name": r["item_name"], "qty": r[key], "amount": r[key + "_amount"]} for r in by_qty],
			"by_sales": [{"item_name": r["item_name"], "qty": r[key], "amount": r[key + "_amount"]} for r in by_sales],
		}

	peak_slot = max(slots, key=lambda s: s["sales"], default=None)
	peak_hour = max(hourly_rows, key=lambda h: h["sales"], default=None)
	busiest_day = max(weekday_rows, key=lambda w: w["total"], default=None)

	return {
		"branch": branch,
		"start_date": str(start_date),
		"end_date": str(end_date),
		"slot_defs": _slot_defs(),
		"summary": {
			"total_sales": total_sales,
			"total_bills": total_bills,
			"avg_bill": round(total_sales / total_bills, 2) if total_bills else 0,
			"items_sold": total_qty,
			"days": days,
			"avg_daily_sales": round(total_sales / days, 2),
			"peak_slot": peak_slot["label"] if peak_slot and peak_slot["sales"] else None,
			"peak_slot_sales": peak_slot["sales"] if peak_slot else 0,
			"peak_hour": f"{peak_hour['label']} - {_hour_label(peak_hour['hour'] + 1)}"
			if peak_hour and peak_hour["sales"]
			else None,
			"peak_hour_sales": peak_hour["sales"] if peak_hour else 0,
			"busiest_weekday": busiest_day["weekday"] if busiest_day and busiest_day["total"] else None,
		},
		"slots": slots,
		"hourly": hourly_rows,
		"daily": daily_rows,
		"weekday": weekday_rows,
		"top_items": ranked[:10],
		"top_earners": sorted(item_agg.values(), key=lambda r: (-r["amount"], -r["qty"]))[:10],
		"top_by_slot": top_by_slot,
		"order_types": sorted(
			[{"order_type": k, "bills": v["bills"], "sales": round(v["sales"], 2)} for k, v in order_types.items()],
			key=lambda r: -r["sales"],
		),
	}


def _menu_items(branch=None):
	"""Items on the active menu(s), so never-sold items show up as slow movers."""
	filters = {"branch": branch} if branch else {}
	menus = [
		m
		for m in frappe.get_all("URY Restaurant", filters=filters, pluck="active_menu")
		if m
	]
	if not menus:
		return []
	return frappe.get_all(
		"URY Menu Item",
		filters={"parent": ["in", menus], "parenttype": "URY Menu", "disabled": 0},
		fields=["item", "item_name", "course"],
	)


@frappe.whitelist()
def get_item_movement(start_date, end_date, branch=None, slot=None, sort="fast"):
	"""Every menu item ranked fastest or slowest first — by quantity sold, or
	by sales value with sort="sales" — including active menu items that didn't
	sell at all in the period."""
	require_manager()
	validate_date_range(start_date, end_date)
	if slot and slot not in SLOT_KEYS:
		frappe.throw(f"slot must be one of {', '.join(SLOT_KEYS)}.")
	start_date, end_date = getdate(start_date), getdate(end_date)
	days = date_diff(end_date, start_date) + 1

	invoices = _get_invoices(start_date, end_date, branch)
	item_agg = _aggregate_items(invoices, _get_invoice_items([inv.name for inv in invoices]), slot)

	for menu_item in _menu_items(branch):
		if menu_item.item not in item_agg:
			item_agg[menu_item.item] = {
				"item_code": menu_item.item,
				"item_name": menu_item.item_name,
				"course": menu_item.course,
				"qty": 0.0,
				"amount": 0.0,
				"bills": 0,
				"last_sold": None,
				**{key: 0.0 for key in SLOT_KEYS},
				**{key + "_amount": 0.0 for key in SLOT_KEYS},
			}

	sort_keys = {
		"fast": lambda r: (-r["qty"], -r["amount"], r["item_name"]),
		"slow": lambda r: (r["qty"], r["amount"], r["item_name"]),
		"sales": lambda r: (-r["amount"], -r["qty"], r["item_name"]),
	}
	if sort not in sort_keys:
		frappe.throw("sort must be one of fast, slow, sales.")
	rows = sorted(item_agg.values(), key=sort_keys[sort])
	total_qty = sum(r["qty"] for r in rows)
	for rank, row in enumerate(rows, 1):
		row["rank"] = rank
		row["pct_qty"] = round(row["qty"] / total_qty * 100, 1) if total_qty else 0
		row["avg_qty_per_day"] = round(row["qty"] / days, 2)

	sold = [r for r in rows if r["qty"]]
	top = max(sold, key=lambda r: r["qty"], default=None)
	return {
		"branch": branch,
		"start_date": str(start_date),
		"end_date": str(end_date),
		"slot": slot,
		"sort": sort,
		"slot_defs": _slot_defs(),
		"summary": {
			"items_sold": len(sold),
			"items_not_sold": len(rows) - len(sold),
			"total_qty": total_qty,
			"total_amount": round(sum(r["amount"] for r in rows), 2),
			"top_item": top["item_name"] if top else None,
			"top_item_qty": top["qty"] if top else 0,
		},
		"rows": rows,
	}

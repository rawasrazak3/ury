from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import flt, get_datetime
from frappe.utils.print_format import print_by_server


def _get_closing_invoice_names(doc):
	"""Invoices covered by the closing.

	URY POS closings don't fill pos_transactions, so fall back to the same rule
	ERPNext's get_pos_invoices uses: the cashier's submitted invoices for this
	POS Profile posted within the shift window.
	"""
	names = [row.pos_invoice for row in doc.pos_transactions if row.pos_invoice]
	if names:
		return names

	rows = frappe.db.sql(
		"""
		select name, timestamp(posting_date, posting_time) as ts
		from `tabPOS Invoice`
		where owner = %s and docstatus = 1 and pos_profile = %s
		""",
		(doc.user, doc.pos_profile),
		as_dict=True,
	)
	start, end = get_datetime(doc.period_start_date), get_datetime(doc.period_end_date)
	return [r.name for r in rows if start <= get_datetime(r.ts) <= end]


def get_closing_summary(doc):
	"""Figures for the shift closing print format (exposed to Jinja)."""
	names = _get_closing_invoice_names(doc)
	summary = frappe._dict(
		bills=0, returns=0, return_amount=0, discount=0,
		order_types=[], payments=[], taxes=[], items=[], cancelled=[], open_orders=[],
	)

	if names:
		invoices = frappe.get_all(
			"POS Invoice",
			filters={"name": ["in", names]},
			fields=["name", "order_type", "grand_total", "rounded_total", "discount_amount", "is_return", "change_amount", "account_for_change_amount"],
		)
		order_types = defaultdict(lambda: [0, 0])
		for inv in invoices:
			total = flt(inv.rounded_total) or flt(inv.grand_total)
			if inv.is_return:
				summary.returns += 1
				summary.return_amount += total
			else:
				summary.bills += 1
			summary.discount += flt(inv.discount_amount)
			order_types[inv.order_type or _("Other")][0] += 1
			order_types[inv.order_type or _("Other")][1] += total
		summary.order_types = sorted(order_types.items())

		# Sales per mode net of change given back, as the POS closing computes it.
		change = {inv.name: inv for inv in invoices}
		sales_by_mode = defaultdict(float)
		for p in frappe.get_all(
			"Sales Invoice Payment",
			filters={"parent": ["in", names], "parenttype": "POS Invoice"},
			fields=["parent", "mode_of_payment", "account", "amount"],
		):
			amount = flt(p.amount)
			inv = change[p.parent]
			if p.account == inv.account_for_change_amount:
				amount -= flt(inv.change_amount)
			sales_by_mode[p.mode_of_payment] += amount

		taxes = defaultdict(float)
		for t in frappe.get_all(
			"Sales Taxes and Charges",
			filters={"parent": ["in", names], "parenttype": "POS Invoice"},
			fields=["description", "rate", "tax_amount_after_discount_amount"],
		):
			taxes[(t.description, flt(t.rate))] += flt(t.tax_amount_after_discount_amount)
		summary.taxes = [frappe._dict(description=k[0], rate=k[1], amount=v) for k, v in taxes.items() if v]

		summary.items = frappe.db.sql(
			"""
			select item_code, item_name, sum(qty) as qty, sum(amount) as amount
			from `tabPOS Invoice Item`
			where parenttype = 'POS Invoice' and parent in %(names)s
			group by item_code, item_name
			order by qty desc, amount desc
			""",
			{"names": names},
			as_dict=True,
		)
	else:
		sales_by_mode = {}

	modes = {row.mode_of_payment: row for row in doc.payment_reconciliation}
	for mode in list(modes) + [m for m in sales_by_mode if m not in modes]:
		row = modes.get(mode)
		summary.payments.append(
			frappe._dict(
				mode_of_payment=mode,
				opening=flt(row.opening_amount) if row else 0,
				sales=flt(sales_by_mode.get(mode)),
				counted=flt(row.closing_amount) if row else 0,
				difference=flt(row.difference) if row else 0,
			)
		)

	summary.cancelled = frappe.get_all(
		"POS Invoice",
		filters={
			"pos_profile": doc.pos_profile,
			"docstatus": 2,
			"modified": ["between", [doc.period_start_date, doc.period_end_date]],
		},
		fields=["name", "grand_total"],
	)
	summary.open_orders = frappe.get_all(
		"POS Invoice",
		filters={"pos_profile": doc.pos_profile, "docstatus": 0},
		fields=["name", "grand_total"],
	)
	return summary


def _get_closing_printer(pos_profile):
	"""Closing printer from the POS Profile, else its first Bill printer."""
	printer = frappe.db.get_value("POS Profile", pos_profile, "custom_closing_printer")
	if printer:
		return printer

	bill_printers = frappe.get_all(
		"URY Printer Settings",
		filters={"parent": pos_profile, "parenttype": "POS Profile", "bill": 1},
		pluck="printer",
		order_by="idx",
		limit=1,
	)
	return bill_printers[0] if bill_printers else None


def print_closing_entry(closing_name, pos_profile):
	print_format = frappe.db.get_value("POS Profile", pos_profile, "custom_closing_print_format")
	if not print_format:
		frappe.throw(_("Set a Closing Print Format in POS Profile {0}.").format(pos_profile))

	printer = _get_closing_printer(pos_profile)
	if not printer:
		frappe.throw(
			_("Set a Closing Printer or a Bill printer in POS Profile {0}.").format(pos_profile)
		)

	print_by_server("POS Closing Entry", closing_name, printer, print_format)


def on_submit(doc, method):
	if not frappe.db.get_value("POS Profile", doc.pos_profile, "custom_auto_print_closing"):
		return

	def print_after_commit():
		# A failed print must never undo or block the shift closing.
		try:
			print_closing_entry(doc.name, doc.pos_profile)
		except Exception:
			frappe.log_error(title=f"Shift Closing Print Failed: {doc.name}")

	# Print only once the closing is committed; still inside the request, so
	# the PDF renderer resolves assets against the site's public URL.
	frappe.db.after_commit.add(print_after_commit)


@frappe.whitelist()
def print_closing(closing_entry):
	"""Reprint a submitted POS Closing Entry on the configured closing printer."""
	doc = frappe.get_doc("POS Closing Entry", closing_entry)
	if not frappe.has_permission("POS Closing Entry", "read", doc=doc):
		frappe.throw(_("Not permitted to print this closing"), frappe.PermissionError)
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted closings can be printed."))

	print_closing_entry(doc.name, doc.pos_profile)
	return "Success"

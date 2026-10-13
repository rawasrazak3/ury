frappe.ui.form.on("POS Closing Entry", {
	refresh(frm) {
		if (frm.doc.docstatus !== 1) return;

		frm.add_custom_button(__("Print Closing"), () => {
			frappe.call({
				method: "ury.ury.api.ury_closing_print.print_closing",
				args: { closing_entry: frm.doc.name },
				freeze: true,
				freeze_message: __("Sending to printer..."),
				callback: () => frappe.show_alert({ message: __("Closing sent to printer"), indicator: "green" }),
			});
		});
	},
});

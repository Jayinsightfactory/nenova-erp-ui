# Catalog responsive scale and compact spacing

User correction: scale changes above 100% were invisible and whitespace excessive.

Cause: safety fit divided all oversized frame dimensions back to the same maximum; overly conservative text estimates and gaps reduced photo area.

Change: retain safe square frame, apply residual scale to clipped photo content in HTML/print/PPT. Explicitly describe cropping in controls. Reduce text/image gap to 0.08cm, row safety gap to 0.12cm and text field gap to 0.04cm. Preserve text overflow warnings.

Side effects: no API/SQL mutations; all ERP order, shipment, stock, estimate and revenue records preserved. Only existing catalog settings and rendered/downloaded presentation change.

Verification: contract fixtures cover requested scales and bounds; browser fixture smoke checks control-driven 50/100/150/200 scaling, multiline text separation and PPT geometry at 1920x1080. Production data is mocked in browser checks.

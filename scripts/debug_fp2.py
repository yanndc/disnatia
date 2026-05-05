import openpyxl, hashlib, unicodedata

wb = openpyxl.load_workbook(r'C:\Users\yann\Downloads\Historique (11).xlsx', data_only=True)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))

def nh(h):
    h = unicodedata.normalize('NFD', str(h))
    h = ''.join(c for c in h if unicodedata.category(c) != 'Mn')
    return h.lower().strip()

header_row = None
for i, row in enumerate(rows):
    cells = [nh(c) if c else '' for c in row]
    if any('date' in c for c in cells) and any('type' in c for c in cells):
        header_row = i
        headers = [str(c) if c else '' for c in row]
        norm_headers = cells
        break

def col(names):
    for name in names:
        for i, h in enumerate(norm_headers):
            if name in h:
                return i
    return None

trade_col = col(['date de transaction', 'date transaction'])
settle_col = col(['date de reglement', 'date reglement', "date d inscription"])
type_col = col(['type de transaction', 'type'])
ticker_col = col(['symbole', 'ticker'])
amount_col = col(["montant de l operation", 'montant'])
currency_col = col(['devise du compte', 'devise'])
qty_col = col(['quantite'])
price_col = col(['prix'])
name_col = col(['description', 'nom'])

data_rows = rows[header_row+1:]

print("Toutes les transactions du fichier avec leur fingerprint :")
print()
for i, row in enumerate(data_rows):
    def v(c):
        if c is None or c >= len(row): return None
        return row[c]

    trade = str(v(trade_col) or '')[:10]
    settle = str(v(settle_col) or '')[:10]
    txtype = str(v(type_col) or '').lower().strip()
    ticker = str(v(ticker_col) or '').upper().strip()
    raw_amount = v(amount_col)
    try:
        amount = str(round(float(str(raw_amount).replace(',', '.')) * 100)) if raw_amount else ''
    except:
        amount = ''
    currency = str(v(currency_col) or '').upper()
    qty = str(v(qty_col) or '')
    try:
        price = str(round(float(str(v(price_col) or '').replace(',', '.')) * 10000)) if v(price_col) else ''
    except:
        price = ''
    sec_name = str(v(name_col) or '').strip()[:60]

    parts = [trade, settle, txtype, ticker, amount, currency, qty, price, sec_name]
    fp = hashlib.sha256('|'.join(parts).encode()).hexdigest()[:32]

    print(f"  L{i+header_row+2:3d} fp={fp}  settle={settle} type={txtype[:25]:25} ticker={ticker:8} amount={raw_amount}")

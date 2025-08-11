# Marcação de Ponto (GitHub Pages + Firebase)

Arquivos: `index.html`, `admin.html`, `app.js`, `firestore.rules`.

Passos resumidos:
1) Firebase → projeto (Spark/Free).
2) Auth → habilite Email/Password.
3) Firestore → crie DB (Production) e publique `firestore.rules`.
4) App Web → copie `firebaseConfig` e cole em `app.js`.
5) GitHub Pages → publique os arquivos.
6) Crie o admin: em `roles/{ADMIN_UID}` coloque `{ "role": "admin" }`.
"""

# write files
files = {
    "index.html": index_html,
    "admin.html": admin_html,
    "app.js": app_js,
    "firestore.rules": firestore_rules,
    "README.md": readme,
}
for name, content in files.items():
    with open(os.path.join(root, name), "w", encoding="utf-8") as f:
        f.write(content)

# zip
zip_path = "/mnt/data/timeclock.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for name in files:
        z.write(os.path.join(root, name), arcname=name)

zip_path
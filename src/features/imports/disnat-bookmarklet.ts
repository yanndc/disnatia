/**
 * Favori (bookmarklet) « Envoyer à DisnatIA ».
 *
 * Le lien est exécuté **dans la page Disnat** : il lit le HTML déjà affiché (aucun identifiant
 * n'est stocké) et le poste à DisnatIA avec le jeton d'import. Le jeton est visible dans l'URL
 * du favori : l'app est mono-utilisateur derrière le verrou de site.
 */
export function buildDisnatBookmarklet(appUrl: string, token: string): string {
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/portfolio/import-session/page`;
  const script = `(async()=>{
    if(!confirm("Envoyer l\\u2019historique Disnat à DisnatIA ?"))return;
    try{
      const r=await fetch(${JSON.stringify(endpoint)},{
        method:"POST",
        headers:{"content-type":"application/json","x-disnat-token":${JSON.stringify(token)}},
        body:JSON.stringify({html:document.documentElement.outerHTML})
      });
      const j=await r.json().catch(()=>({}));
      if(r.ok){
        const lignes=["DisnatIA — "+j.rowsTotal+" ligne(s) lues sur "+(j.accounts||[]).length+" compte(s).",
          j.updated+" compte(s) mis à jour · "+j.duplicates+" déjà à jour"+(j.errors?(" · "+j.errors+" erreur(s)"):"")];
        if(j.errorAccounts&&j.errorAccounts.length)lignes.push("",...j.errorAccounts);
        alert(lignes.join("\\n"));
      }else{
        alert("DisnatIA — erreur : "+(j.error||r.status));
      }
    }catch(e){alert("DisnatIA — échec réseau : "+e.message);}
  })();`;
  return `javascript:${script.replace(/\s+/g, " ")}`;
}

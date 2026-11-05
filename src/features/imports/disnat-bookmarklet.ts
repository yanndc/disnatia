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
    if(!confirm("Envoyer cette page Disnat à DisnatIA ?"))return;
    try{
      const r=await fetch(${JSON.stringify(endpoint)},{
        method:"POST",
        headers:{"content-type":"application/json","x-disnat-token":${JSON.stringify(token)}},
        body:JSON.stringify({html:document.documentElement.outerHTML,url:location.href})
      });
      const j=await r.json().catch(()=>({}));
      if(r.ok){
        if(j.mode==="summary"){
          const n=${
            JSON.stringify(
              "DisnatIA — encaisse du client enregistrée le %date% : %cash% $ d'encaisse, %sec% $ de titres, %total% $ au total.",
            )
          };
          const f=(v)=>new Intl.NumberFormat("fr-CA",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0);
          alert(n.replace("%date%",j.asOfDate).replace("%cash%",f(j.cashCad)).replace("%sec%",f(j.securitiesCad)).replace("%total%",f(j.totalCad)));
          return;
        }
        const lignes=["DisnatIA — "+(j.rowsTotal??0)+" ligne(s) lues sur "+(j.accounts||[]).length+" compte(s).",
          (j.updated||0)+" compte(s) mis à jour · "+(j.duplicates||0)+" déjà à jour"+(j.errors?(" · "+j.errors+" erreur(s)"):"")];
        if(j.errorAccounts&&j.errorAccounts.length)lignes.push("",...j.errorAccounts);
        alert(lignes.join("\\n"));
      }else{
        alert("DisnatIA — "+(j.error||("erreur "+r.status)));
      }
    }catch(e){alert("DisnatIA — échec réseau : "+e.message);}
  })();`;
  return `javascript:${script.replace(/\s+/g, " ")}`;
}

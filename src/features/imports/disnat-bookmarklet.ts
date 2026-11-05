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
    const collectHtml=()=>{
      let html=document.documentElement.outerHTML;
      document.querySelectorAll("iframe").forEach((frame)=>{
        try{
          const doc=frame.contentDocument;
          if(doc&&doc.documentElement)html+="\\n<!-- iframe -->\\n"+doc.documentElement.outerHTML;
        }catch(_){}
      });
      return html;
    };
    const secours=()=>{
      const html=collectHtml();
      try{
        const ta=document.createElement("textarea");
        ta.value=html;ta.style.position="fixed";ta.style.top="-9999px";
        document.body.appendChild(ta);ta.select();
        const ok=document.execCommand("copy");
        document.body.removeChild(ta);
        if(ok){alert("DisnatIA — envoi impossible. La page (HTML complet) est dans le presse-papier : colle-la dans l'onglet « Page Disnat (coller) » de DisnatIA.");return;}
      }catch(_){}
      try{
        const a=document.createElement("a");
        a.href=URL.createObjectURL(new Blob([html],{type:"text/html"}));
        a.download="disnatia-"+(new Date().toISOString().slice(0,10))+".html";
        a.click();URL.revokeObjectURL(a.href);
        alert("DisnatIA — envoi impossible. La page a été téléchargée : dépose le fichier dans l'onglet « Page Disnat (coller) » de DisnatIA.");
      }catch(e2){alert("DisnatIA — envoi impossible ("+e2.message+").");}
    };
    try{
      const r=await fetch(${JSON.stringify(endpoint)},{
        method:"POST",
        headers:{"content-type":"application/json","x-disnat-token":${JSON.stringify(token)}},
        body:JSON.stringify({html:collectHtml(),url:location.href})
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
        if(r.status===422||r.status>=500)secours();
      }
    }catch(e){
      alert("DisnatIA — échec réseau : "+e.message);
      secours();
    }
  })();`;
  return `javascript:${script.replace(/\s+/g, " ")}`;
}

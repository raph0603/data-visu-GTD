from playwright.sync_api import sync_playwright
from pathlib import Path
import json
import sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial

release=False
production=True
project=Path(__file__).resolve().parents[1]
base='http://127.0.0.1:5175' if production else 'http://127.0.0.1:5174'
if production:
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
    directory=str(project/'dist')
    server=ThreadingHTTPServer(('127.0.0.1',5175),partial(QuietHandler,directory=directory))
    threading.Thread(target=server.serve_forever,daemon=True).start()
out=project/'test-results/flow-browser';out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100})
    errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(base+'/#v=flow')
    page.wait_for_selector('.gtd-flow-surface #chart')
    frame=page
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow) && (document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.links.length > 0')
    page.wait_for_timeout(1200)
    print(json.dumps({'title':page.title(),'state':frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getState()'),'total':frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals'),'errors':errors},ensure_ascii=True))
    if release:
        assert frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph().totals.a.count') == 181691
        page.locator('.folio').nth(0).click();page.wait_for_selector('.cv-globe-canvas')
        page.locator('.folio').nth(3).click();page.wait_for_selector('.leaderboard-row')
        page.locator('.folio').nth(1).click()
        assert 'en préparation' in page.locator('.planche-name').inner_text()
        assert not errors,errors
        print('PASS extracted ZIP: flow, map, leaderboard, unchanged atlas; no page errors',flush=True)
        browser.close();sys.exit(0)
    page.screenshot(path=str(out/'sankey.png'),full_page=True)
    checks=[]
    assert page.locator('iframe').count()==0, 'Sankey must be native, not embedded'
    assert len(page.frames)==1, 'Only the main document is allowed'
    def check(name, condition):
        assert condition,name
        checks.append(name)
        print('PASS '+name,flush=True)
    check('native DOM without iframe',page.locator('iframe').count()==0 and len(page.frames)==1)
    check('bundled worker running',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).engine()')=='worker')
    check('unfiltered context visible', 'Tous les pays' in frame.locator('#scopeTitle').inner_text())
    check('181691 incidents',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count')==181691)
    frame.locator('.node').first.focus()
    check('node tooltip',frame.locator('#tooltip').is_visible())
    frame.locator('.node').first.press('Enter')
    check('node selection',len(frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getSelection()'))==1)
    frame.locator('#isolateButton').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count < 181691')
    check('selection filter',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count')>0)
    frame.locator('#resetButton').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 68391')
    frame.locator('.flow').first.focus()
    check('link tooltip',frame.locator('#tooltip').is_visible())
    frame.locator('#radialButton').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getState().morph === 100')
    check('radial finite paths',frame.evaluate("[...document.querySelectorAll('#chart path')].every(p=>!/NaN|Infinity/.test(p.getAttribute('d')||''))"))
    page.screenshot(path=str(out/'radial.png'),full_page=True)
    frame.locator('#horizontalButton').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getState().morph === 0')
    frame.locator('#yearStart').fill('1993');frame.locator('#yearStart').dispatch_event('change')
    frame.locator('#yearEnd').fill('1993');frame.locator('#yearEnd').dispatch_event('change')
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 0')
    check('1993 empty state',frame.locator('#emptyState').is_visible())
    check('1993 missing notice','1993' in frame.locator('#qualityNote').inner_text())
    page.get_by_role('button',name='Reprendre la sélection commune').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 181691')
    frame.locator('#compareToggle').check()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.b.count > 0')
    check('comparison context visible', 'Période B' in frame.locator('#scopePeriod').inner_text())
    check('comparison A/B',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.total === (document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count + (document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.b.count'))
    frame.locator('#metric').select_option('killed')
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getState().metric === "killed" && (document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.total > 400000')
    check('casualties metric',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.killed')==411868)
    frame.locator('#exportMenuButton').click()
    with page.expect_download() as dl: frame.locator('#exportCSV').click()
    dl.value.save_as(str(out/'export-flux.csv'))
    check('CSV export', (out/'export-flux.csv').stat().st_size>100)
    frame.locator('#importButton').click()
    fixture='eventid,iyear,country_txt,region_txt,attacktype1_txt,weaptype1_txt,targtype1_txt,gname,suicide,nkill,nwound\n1,2017,X,R,A,W,T,G,0,,0\n2,2017,X,R,A,W,T,G,1,3,5\n'
    frame.locator('#csvInput').set_input_files({'name':'demo.csv','mimeType':'text/csv','buffer':fixture.encode()})
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 2')
    check('import named in context', 'demo.csv' in frame.locator('#scopeDataset').inner_text())
    check('CSV import',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.knownKilled')==1)
    page.get_by_role('button',name='Reprendre la sélection commune').click()
    page.wait_for_timeout(200)
    check('import isolation',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count')==2)
    frame.locator('#importButton').click();frame.locator('#restoreData').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 68391')
    check('base restore',True)
    # Enter through the same shared hash used by other views, then navigate normally.
    page.goto(base+'/#v=map&t=2013-2017&p=country:FRA&f=country:FRA')
    page.wait_for_selector('.cv-globe-canvas')
    page.wait_for_timeout(1200)
    check('country map mounted',page.locator('.cv-globe-canvas').is_visible())
    page.screenshot(path=str(out/'map.png'),full_page=True)
    page.locator('.folio').nth(2).click()
    page.wait_for_selector('.gtd-flow-surface #chart');frame=page
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow) && (document.querySelector(".gtd-flow-surface")?.flow).getState().filters.country?.includes("France") && (document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count > 0')
    check('France in dynamic heading', 'France' in frame.locator('#scopeTitle').inner_text())
    check('France filter visible without opening sidebar', 'Pays : France' in frame.locator('#activeFilters').inner_text())
    check('period in heading', '2013–2017' in frame.locator('#scopePeriod').inner_text())
    check('country and period linking',frame.evaluate('(document.querySelector(".gtd-flow-surface")?.flow).getState().period')==[2013,2017])
    frame.locator('#boot').wait_for(state='hidden')
    page.wait_for_timeout(900)
    page.screenshot(path=str(out/'linked-france.png'),full_page=True)
    frame.get_by_role('button',name='Retirer le filtre Pays : France',exact=True).click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 68391')
    check('removing chip updates heading', 'Tous les pays' in frame.locator('#scopeTitle').inner_text())
    page.goto(base+'/#v=flow&t=2013-2017&p=country:FRA,country:DEU')
    page.wait_for_selector('.gtd-flow-surface #chart');frame=page
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow) && (document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count > 0 && document.getElementById("scopeTitle").textContent.includes("Allemagne")')
    check('multiple countries named', 'France' in frame.locator('#scopeTitle').inner_text())
    check('historical labels explained', 'West Germany' in frame.locator('#scopeTerritories').inner_text())
    frame.locator('#boot').wait_for(state='hidden')
    frame.locator('#resetButton').click()
    frame.wait_for_function('(document.querySelector(".gtd-flow-surface")?.flow).getGraph()?.totals.a.count === 68391')
    check('reset clears visible country context', 'Tous les pays' in frame.locator('#scopeTitle').inner_text())
    page.locator('.folio').nth(3).click()
    page.wait_for_selector('.leaderboard-row')
    check('leaderboard mounted',page.locator('.leaderboard-row').count()>0)
    page.screenshot(path=str(out/'leaderboard.png'),full_page=True)
    page.locator('.folio').nth(1).click()
    check('atlas remains placeholder','en préparation' in page.locator('.planche-name').inner_text())
    page.locator('.folio').nth(0).click()
    page.wait_for_selector('.cv-globe-canvas')
    check('map after flow unmount',page.locator('.cv-globe-canvas').is_visible())
    for _ in range(3):
        page.locator('.folio').nth(2).click()
        page.locator('.folio').nth(0).click()
    page.wait_for_selector('.cv-globe-canvas')
    page.wait_for_timeout(400)
    check('rapid mount and unmount',page.locator('.gtd-flow-surface').count()==0)
    check('no browser errors',not errors)
    (out/'browser-report.json').write_text(json.dumps({'checks':checks,'errors':errors},indent=2),encoding='utf-8')
    browser.close()



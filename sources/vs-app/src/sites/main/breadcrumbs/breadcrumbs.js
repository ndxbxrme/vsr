angular.module('vs-app')
.factory('breadcrumbs', () => {
  let allHistory = JSON.parse(localStorage.getItem('allHistory') || '[]');
  allHistory = allHistory.slice(-100);
  const history = [];
  let favorites = [];
  const updateFavorites = () => {
    favorites = allHistory.reduce((res, item) => {
      let hItem = res.find(h => h.url === item.url);
      if(!hItem) {
        hItem = JSON.parse(JSON.stringify(item));
        hItem.count = 0;
        res.push(hItem);
      }
      hItem.count++;
      return res;
    }, []).sort((a,b) => a.count > b.count ? -1 : 1).slice(0, 10);
  }
  return {
    push: (historyItem) => {
      const {url,title,params} = historyItem;
      historyItem.url = historyItem.url.toString();
      const historyIndex = history.findIndex(item => item.url===url);
      if(historyIndex < 0) {
        history.push({url,title,params,date:new Date()});
      }
      else {
        history.splice(historyIndex, history.length);
        history.push({url,title,params,date:new Date()});
      }
      allHistory.push({url,title,params,date:new Date()});
      allHistory = allHistory.slice(-100);
      updateFavorites();
      localStorage.setItem('allHistory', JSON.stringify(allHistory));
    },
    setInfo: (info) => {
      history[history.length-1].info = info;
      allHistory[allHistory.length-1].info = info;
      allHistory = allHistory.slice(-100);
      localStorage.setItem('allHistory', JSON.stringify(allHistory));
      updateFavorites();
    },
    getHistory: () => history.slice(-6),
    getFavorites: () => favorites,
    getRecent: () => {
      const myhistory = allHistory.reduce((res, item) => {
        let hItem = res.find(h => h.url === item.url);
        if(!hItem) {
          hItem = JSON.parse(JSON.stringify(item));
          hItem.count = 0;
          res.push(hItem);
        }
        hItem.count++;
      }, []);
      return myhistory.sort((a,b) => a.date > b.date ? -1 : 1).slice(0, 10);
    },
    getSiteAndTitle: (historyItem) => {
      let [site,title] = historyItem.title.split(/ - /);
      if(!title) {
        title = site;
        site = 'Main';
      }
      site = site.replace(/vitalspace\s*/gi, '');
      if(site.trim() === 'Conveyancing') {
        site = 'Sales';
      }
      if(/^\/?agency(\/dashboard)?\/?$/i.test(historyItem.url)) {
        title = 'Conveyancing';
      }
      if(/^\/?agency\/client-management/i.test(historyItem.url)) {
        title = 'Available';
      }
      if(/^\/?agency\/coming-soon/i.test(historyItem.url)) {
        site = 'Sales';
      }
      return {site,title};
    }
  }
})
.directive('breadcrumbs', function(breadcrumbs) {
  return {
    template: require('./breadcrumbs.html').default,
    replace: true,
    link: function(scope) {
      scope.breadcrumbs = breadcrumbs;
    }
  }
})
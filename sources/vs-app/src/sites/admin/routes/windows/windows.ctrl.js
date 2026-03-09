import './windows.styl'
angular.module('vs-admin')
.directive('adminWindows', function($http, $timeout, $state, env, alert) {
  return {
    template: require('./windows.html').default,
    scope: {},
    link: (scope) => {
      scope.newWindow = {};
      scope.currentWindowDate = null;
      scope.currentWindowsCompleted = false;
      scope.windows = [
        {
          type: 'FOR_SALE',
          name: 'For Sale',
          items: [],
          link: 'clientmanagement'
        },
        {
          type: 'SOLD',
          name: 'Sold Slip',
          items: [],
          link: 'conveyancing'
        },
        {
          type: 'PRICE_REDUCTION',
          name: 'Price Reduction',
          items: [],
          link: 'conveyancing'
        },
        {
          type: 'REMOVE_SLIP',
          name: 'Fallen Through',
          items: [],
          link: 'conveyancing'
        },
        {
          type: 'TO_LET',
          name: 'To Let',
          items: [],
          link: 'lettings'
        },
        {
          type: 'LET_AGREED',
          name: 'Let Slip',
          items: [],
          link: 'lettings'
        },
        {
          type: 'COMPLETED_SELLING',
          name: 'Sales Remove',
          items: []
        },
        {
          type: 'COMPLETED_LETTING',
          name: 'Lettings Remove',
          items: []
        },
      ]
      const drawWindows = (items) => {
        scope.currentWindowsCompleted = false;
        if(!scope.currentWindowDate) {
          const incompleteWindows = items.filter(item => !item.completed && item.type);
          const firstWindow = incompleteWindows.sort((a, b) => a.date > b.date ? 1 : -1)[0];
          if(firstWindow) {
            scope.currentWindowDate = firstWindow.date;
          }
          else {
            scope.currentWindowDate = getPreviousThursday(new Date(new Date().getTime() + 24 * 60 * 60 * 1000));
          }
        }
        scope.selectedDate = new Date(scope.currentWindowDate);

        scope.windows.forEach(window => {
          window.items = items.filter(item => item.type === window.type);
          if(window.items.length) {
            scope.currentWindowsCompleted = scope.currentWindowsCompleted || window.items[0].completed;
          }
        });
      }
      scope.windowsList = scope.list('main:boards', {where:{isWindow:true}}, (items) => {
        drawWindows(items.items);
      })
      function getNextThursdays() {
        const today = new Date();
        const currentDayOfWeek = today.getDay();
        let daysUntilNextThursday = (4 - currentDayOfWeek + 7) % 7;
      
        const thursdays = [];
        for (let i = 0; i < 4; i++) {
          const nextThursday = new Date(today);
          nextThursday.setDate(today.getDate() + daysUntilNextThursday);
          thursdays.push(nextThursday.toISOString().split('T')[0]);
          daysUntilNextThursday += 7;
        }
        return thursdays;
      }
      function getPreviousThursday(inputDate) {
        const date = new Date(inputDate);
        date.setHours(12, 0, 0, 0); // Set the time to 12:00 PM (noon)
      
        const currentDayOfWeek = date.getDay(); // 0 for Sunday, 1 for Monday, ..., 6 for Saturday
        const daysUntilPreviousThursday = (currentDayOfWeek + 7 - 4) % 7; // Calculate days until the previous (or current) Thursday
      
        const previousThursday = new Date(date);
        previousThursday.setDate(date.getDate() - daysUntilPreviousThursday);
        return previousThursday.toISOString().split('T')[0];
      }
      scope.upcomingThursdays = getNextThursdays();
      scope.save = () => {
        if(scope.newWindow.address && scope.newWindow.type) {
          scope.newWindow.isWindow = true;
          scope.windowsList.save(scope.newWindow);
          scope.newWindow = {};
        }
      }
      scope.selectDate = () => {
        scope.currentWindowDate = getPreviousThursday(scope.selectedDate);
        drawWindows(scope.windowsList.items);
      }
      scope.searchWindows = () => {
        if(!scope.search.trim()) {
          scope.searchResults = [];
        }
        else {
          scope.searchResults = scope.windowsList.items.filter(window => window.address.toLowerCase().includes(scope.search.toLowerCase()))
          .sort((a, b) => a.date < b.date ? 1 : -1);
        }
      }
      scope.windowName = (type) => {
        const window = scope.windows.find(window => window.type === type);
        return window.name;
      }
      scope.selectSearchResult = (date) => {
        scope.currentWindowDate = date;
        scope.searchResults = [];
        scope.search = null;
        drawWindows(scope.windowsList.items);
      }
      scope.completeWindows = () => {
        scope.currentWindowDate = null;
        scope.windows.forEach(window => {
          window.items.forEach(item => {
            item.completed = scope.currentWindowsCompleted ? null : new Date().toISOString().split('T')[0];
            scope.windowsList.save(item);
          })
        })
      }
      scope.deleteItem = (item) => {
        if(confirm('Are you sure?')) {
          scope.windowsList.delete(item);
        }
      }
      scope.printWindows = () => {
        let html = `<h2>WINDOWS LIST <strong>${new Date(scope.currentWindowDate).toDateString().replace('Thu', 'Thursday')}</strong></h2>`;
        scope.windows.forEach(window => {
          html += `<h4 style="background: #f15b25; color: white; padding-left: 10px">${window.name}</h4>`;
          if(window.items.length) {
            html += window.items.map(item => `<p>${item.address}</p>`).join('');
          }
          else {
            html += '<p>nothing</p>';
          }
        });
        document.querySelector('.printScreen').innerHTML = html;
        window.print();
      }
    }
  }
});
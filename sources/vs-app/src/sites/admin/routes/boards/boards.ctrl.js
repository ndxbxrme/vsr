import './boards.styl'
angular.module('vs-admin')
.directive('adminBoards', function($http, $timeout, $state, env, alert) {
  return {
    template: require('./boards.html').default,
    scope: {},
    link: (scope) => {
      scope.newBoard = {};
      scope.currentBoardDate = null;
      scope.currentBoardsCompleted = false;
      scope.boards = [
        {
          type: 'FOR_SALE',
          name: 'For Sale',
          items: [],
          link: 'clientmanagement'
        },
        {
          type: 'SOLD',
          name: 'Sold',
          items: [],
          link: 'conveyancing'
        },
        {
          type: 'SOLD_1_WEEK',
          name: 'Sold in 1 Week',
          items: [],
          link: 'conveyancing'
        },
        {
          type: 'REMOVE_SLIP',
          name: 'Remove Slip',
          items: [],
          link: 'lettings'
        },
        {
          type: 'TO_LET',
          name: 'To Let',
          items: [],
          link: 'lettings'
        },
        {
          type: 'LET_MANAGED',
          name: 'Let & Managed',
          items: [],
          link: 'lettings'
        },
        {
          type: 'SORRY_LET',
          name: 'Sorry I\'m Let',
          items: [],
          link: 'lettings'
        },
        {
          type: 'REMOVE',
          name: 'Remove',
          items: []
        },
      ]
      const drawBoards = (items) => {
        scope.currentBoardsCompleted = false;
        if(!scope.currentBoardDate) {
          const incompleteBoards = items.filter(item => !item.completed && item.type);
          const firstBoard = incompleteBoards.sort((a, b) => a.date > b.date ? 1 : -1)[0];
          if(firstBoard) {
            scope.currentBoardDate = firstBoard.date;
          }
          else {
            scope.currentBoardDate = getPreviousThursday(new Date(new Date().getTime() + 24 * 60 * 60 * 1000));
          }
        }
        scope.selectedDate = new Date(scope.currentBoardDate);
        const currentItems = items.filter(item => item.date === scope.currentBoardDate);

        scope.boards.forEach(board => {
          board.items = currentItems.filter(item => item.type === board.type);
          if(board.items.length) {
            scope.currentBoardsCompleted = scope.currentBoardsCompleted || board.items[0].completed;
          }
        });
      }
      scope.boardsList = scope.list('main:boards', {where:{isWindow:null}}, (items) => {
        drawBoards(items.items);
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
        if(scope.newBoard.address && scope.newBoard.type && scope.newBoard.date) {
          scope.boardsList.save(scope.newBoard);
          scope.newBoard = {};
        }
      }
      scope.selectDate = () => {
        scope.currentBoardDate = getPreviousThursday(scope.selectedDate);
        drawBoards(scope.boardsList.items);
      }
      scope.searchBoards = () => {
        if(!scope.search.trim()) {
          scope.searchResults = [];
        }
        else {
          scope.searchResults = scope.boardsList.items.filter(board => board.address.toLowerCase().includes(scope.search.toLowerCase()))
          .sort((a, b) => a.date < b.date ? 1 : -1);
        }
      }
      scope.boardName = (type) => {
        const board = scope.boards.find(board => board.type === type);
        return board.name;
      }
      scope.selectSearchResult = (date) => {
        scope.currentBoardDate = date;
        scope.searchResults = [];
        scope.search = null;
        drawBoards(scope.boardsList.items);
      }
      scope.completeBoards = () => {
        scope.currentBoardDate = null;
        scope.boards.forEach(board => {
          board.items.forEach(item => {
            item.completed = scope.currentBoardsCompleted ? null : new Date().toISOString().split('T')[0];
            scope.boardsList.save(item);
          })
        })
      }
      scope.deleteItem = (item) => {
        if(confirm('Are you sure?')) {
          scope.boardsList.delete(item);
        }
      }
      scope.printBoards = () => {
        let html = `<h2>BOARDS LIST <strong>${new Date(scope.currentBoardDate).toDateString().replace('Thu', 'Thursday')}</strong></h2>`;
        scope.boards.forEach(board => {
          html += `<h4 style="background: #f15b25; color: white; padding-left: 10px">${board.name}</h4>`;
          if(board.items.length) {
            html += board.items.map(item => `<p>${item.address}</p>`).join('');
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
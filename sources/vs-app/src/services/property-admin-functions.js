const initForSale = (propertyadmin, property) => {
  if(propertyadmin && propertyadmin.item) {
    if (propertyadmin.item.priceReduction && propertyadmin.item.priceReduction.dateOfReduction)
      propertyadmin.item.priceReduction.dateOfReduction = new Date(propertyadmin.item.priceReduction.dateOfReduction);
    if (propertyadmin.item.fallenThrough && propertyadmin.item.fallenThrough.date)
      propertyadmin.item.fallenThrough.date = new Date(propertyadmin.item.fallenThrough.date);
    if (propertyadmin.item.exchangedCompleted && propertyadmin.item.exchangedCompleted.dateExchange)
      propertyadmin.item.exchangedCompleted.dateExchange = new Date(propertyadmin.item.exchangedCompleted.dateExchange);
    if (propertyadmin.item.exchangedCompleted && propertyadmin.item.exchangedCompleted.dateCompletion)
      propertyadmin.item.exchangedCompleted.dateCompletion = new Date(propertyadmin.item.exchangedCompleted.dateCompletion);
    if (propertyadmin.item.letAgreed && propertyadmin.item.letAgreed.progressionStarted)
      propertyadmin.item.letAgreed.progressionStarted = new Date(propertyadmin.item.letAgreed.progressionStarted);
  }
  return propertyadmin;
}
const propertyAdminFunctions = ($scope, alert) => {
  function addNote(note) {
    let noteParent = $scope.property;
    if($scope.property.item.$case) {
      noteParent = $scope.property.item.$case;
    }
    noteParent && noteParent.item.notes && noteParent.item.notes.push({
      date: new Date(),
      item: 'Note',
      side: '',
      text: '**' + note + '**',
      user: $scope.auth.getUser()
    });
    noteParent && noteParent.save();
  }
  function getNextThursdays(count) {
    const today = new Date(new Date().valueOf() + (24 * 60 * 60 * 1000));
    const currentDayOfWeek = today.getDay();
    let daysUntilNextThursday = (4 - currentDayOfWeek + 7) % 7;

    const thursdays = [];
    for (let i = 0; i < count; i++) {
      const nextThursday = new Date(today);
      nextThursday.setDate(today.getDate() + daysUntilNextThursday);
      thursdays.push(nextThursday.toISOString().split('T')[0]);
      daysUntilNextThursday += 7;
    }
    return thursdays;
  }
  $scope.boardDates = getNextThursdays(4);
  $scope.epcOptions = [
    'No',
    new Date().toISOString().split('T')[0]
  ]
  $scope.ftOptions = ['No board', ...getNextThursdays(2)];
  $scope.saveITMDetails = function (isLetting) {
    $scope.propertyadmin.item.instructionToMarket.isLetting = isLetting;
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.instructionToMarket.boardOrderedDate) && (item.type === 'FOR_SALE') && (!item.isWindow));
    if (!board) {
      if ($scope.propertyadmin.item.instructionToMarket.boardOrderedDate && ($scope.propertyadmin.item.instructionToMarket.boardOrderedDate !== 'No board')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.instructionToMarket.boardOrderedDate,
          type: (isLetting ? 'TO_LET' : 'FOR_SALE'),
          list: 'itm'
        });
      }
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === 'FOR_SALE') && (item.isWindow) && (item.list === 'itm'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.instructionToMarket.windowsCard && ($scope.propertyadmin.item.instructionToMarket.windowsCard === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          type: (isLetting ? 'TO_LET' : 'FOR_SALE'),
          isWindow: true,
          list: 'itm'
        });
      }
    }
    if ($scope.propertyadmin.item.instructionToMarket.epcOrderedDate && $scope.propertyadmin.item.instructionToMarket.epcOrderedDate !== 'No') {
      $scope.propertyadmin.item.instructionToMarket.epcReceived = $scope.propertyadmin.item.instructionToMarket.epcReceived || false;
    }
    $scope.property.item.instructionToMarket = {
      epcReceived:$scope.propertyadmin.item.instructionToMarket.epcReceived,
      epcOrderedDate:$scope.propertyadmin.item.instructionToMarket.epcOrderedDate,
      misdescriptionsReceived:$scope.propertyadmin.item.instructionToMarket.misdescriptionsReceived
    };
    $scope.propertyadmin.save();
    $scope.property.save();
    addNote('Instruction to Market - ACTIONED');
    alert.log('Instruction to market details saved');
  }
  $scope.clearITMDetails = function (isLetting) {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.instructionToMarket.boardOrderedDate) && (item.type === (isLetting ? 'TO_LET' : 'FOR_SALE')) && (!item.isWindow));
    if (board) {
      $scope.boardsList.delete(board);
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === (isLetting ? 'TO_LET' : 'FOR_SALE')) && (item.isWindow) && (item.list === 'itm'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.property.item.instructionToMarket = null;
    $scope.property.save();
    $scope.propertyadmin.item.instructionToMarket = null;
    $scope.propertyadmin.save();
    addNote('Instruction to Market - CLEARED');
    alert.log('Instruction to market details cleared');
  }
  $scope.saveSSTCDetails = function () {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.soldSubjectToContract.boardUpdated) && (item.type === $scope.propertyadmin.item.soldSubjectToContract.boardType) && (!item.isWindow));
    if (!board) {
      if ($scope.propertyadmin.item.soldSubjectToContract.boardUpdated && ($scope.propertyadmin.item.soldSubjectToContract.boardUpdated !== 'No board')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.soldSubjectToContract.boardUpdated,
          type: $scope.propertyadmin.item.soldSubjectToContract.boardType,
          list: 'sstc'
        });
      }
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.isWindow) && (item.list === 'sstc'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.soldSubjectToContract.soldInWindow && ($scope.propertyadmin.item.soldSubjectToContract.soldInWindow === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          type: 'SOLD',
          isWindow: true,
          list: 'sstc'
        });
      }
    }
    $scope.propertyadmin.save();
    addNote('Sold Subject To Contract - ACTIONED');
    alert.log('Sold Subject To Contract details saved');
  }
  $scope.clearSSTCDetails = function () {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.soldSubjectToContract.boardUpdated) && (item.type === $scope.propertyadmin.item.soldSubjectToContract.boardType) && (!item.isWindow));
    if (board) {
      $scope.boardsList.delete(board);
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.isWindow) && (item.list === 'sstc'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.propertyadmin.item.soldSubjectToContract = null;
    $scope.propertyadmin.save();
    addNote('Sold Subject To Contract - CLEARED');
    alert.log('Sold Subject To Contract details cleared');
  }
  $scope.savePRDetails = function () {
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.isWindow) && (item.list === 'pr'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.priceReduction.newWindowCard && ($scope.propertyadmin.item.priceReduction.newWindowCard === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          type: 'PRICE_REDUCTION',
          isWindow: true,
          list: 'pr'
        });
      }
    }
    $scope.propertyadmin.save();
    addNote('Price Reduction - ACTIONED');
    alert.log('Price Reduction details saved');
  }
  $scope.clearPRDetails = function () {
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.isWindow) && (item.list === 'PR'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.propertyadmin.item.priceReduction = null;
    $scope.propertyadmin.save();
    addNote('Price Reduction - CLEARED');
    alert.log('Price Reduction details cleared');
  }
  $scope.saveFTDetails = function () {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.fallenThrough.boardUpdated) && (item.type === 'REMOVE_SLIP') && (!item.isWindow));
    if (!board) {
      if ($scope.propertyadmin.item.fallenThrough.boardUpdated && ($scope.propertyadmin.item.fallenThrough.boardUpdated !== 'No board')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.fallenThrough.boardUpdated,
          type: 'REMOVE_SLIP',
          list: 'ft'
        });
      }
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === 'REMOVE_SLIP') && (item.isWindow) && (item.list === 'ft'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.fallenThrough.backInWindow && ($scope.propertyadmin.item.fallenThrough.backInWindow === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          type: 'REMOVE_SLIP',
          isWindow: true,
          list: 'ft'
        });
      }
    }
    $scope.propertyadmin.save();
    addNote('Fallen Through - ACTIONED');
    alert.log('Fallen Through details saved');
  }
  $scope.clearFTDetails = function () {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.fallenThrough.boardUpdated) && (item.type === 'REMOVE_SLIP') && (!item.isWindow));
    if (board) {
      $scope.boardsList.delete(board);
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === 'REMOVE_SLIP') && (item.isWindow) && (item.list === 'ft'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.propertyadmin.item.fallenThrough = null;
    $scope.propertyadmin.save();
    addNote('Fallen Through - CLEARED');
    alert.log('Fallen Through details cleared');
  }
  $scope.saveECDetails = function (isLetting) {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.exchangedCompleted.boardUpdated) && (item.type === 'REMOVE') && (!item.isWindow));
    if (!board) {
      if ($scope.propertyadmin.item.exchangedCompleted && $scope.propertyadmin.item.exchangedCompleted.boardUpdated && ($scope.propertyadmin.item.exchangedCompleted.boardUpdated !== 'No board')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.exchangedCompleted.boardUpdated,
          type: 'REMOVE',
          list: 'ec'
        });
      }
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type.startsWith('COMPLETED')) && (item.isWindow) && (item.list === 'ec'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.exchangedCompleted && $scope.propertyadmin.item.exchangedCompleted.soldInWindow && ($scope.propertyadmin.item.exchangedCompleted.soldInWindow === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          type: 'COMPLETED_' + $scope.side,
          isWindow: true,
          list: 'ec'
        });
      }
    }
    $scope.propertyadmin.save();
    addNote((isLetting ? 'Rental Completed' : 'Exchanged and Completed') + ' - ACTIONED');
    alert.log(isLetting ? 'Rental Completed details saved' : 'Exchanged and Completed details saved');
  }
  $scope.clearECDetails = function (isLetting) {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.exchangedCompleted.boardUpdated) && (item.type === 'REMOVE') && (!item.isWindow));
    if (board) {
      $scope.boardsList.delete(board);
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type.startsWith('COMPLETED')) && (item.isWindow) && (item.list === 'ec'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.propertyadmin.item.exchangedCompleted = null;
    $scope.propertyadmin.save();
    addNote((isLetting ? 'Rental Completed' : 'Exchanged and Completed') + ' - CLEARED');
    alert.log(isLetting ? 'Rental Completed details completed' : 'Exchanged and Completed details completed');
  }
  $scope.saveWDetails = function (isLetting) {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.withdrawn.boardRemoved) && (item.type === 'REMOVE') && (!item.isWindow));
    if (!board) {
      if ($scope.propertyadmin.item.withdrawn && $scope.propertyadmin.item.withdrawn.boardRemoved && ($scope.propertyadmin.item.withdrawn.boardRemoved !== 'No board')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.withdrawn.boardRemoved,
          type: 'REMOVE',
          list: 'w'
        });
      }
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === 'REMOVE') && (item.isWindow) && (item.list === 'w'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.withdrawn && $scope.propertyadmin.item.withdrawn.windowCardRemoved && ($scope.propertyadmin.item.withdrawn.windowCardRemoved === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          type: 'REMOVE',
          isWindow: true,
          list: 'w'
        });
      }
    }
    $scope.propertyadmin.save();
    addNote('Withdrawn - ACTIONED');
    alert.log('Withdrawn details saved');
  }
  $scope.clearWDetails = function (isLetting) {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.withdrawn.boardRemoved) && (item.type === 'REMOVE') && (!item.isWindow));
    if (board) {
      $scope.boardsList.delete(board);
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === 'REMOVE') && (!item.isWindow) && (item.list === 'w'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.propertyadmin.item.withdrawn = null;
    $scope.propertyadmin.save();
    addNote('Withdrawn - CLEARED');
    alert.log('Withdrawn details completed');
  }
  $scope.saveLADetails = function () {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.letAgreed.boardUpdated) && (item.type === $scope.propertyadmin.item.letAgreed.boardType) && (!item.isWindow));
    if (!board) {
      if ($scope.propertyadmin.item.letAgreed.boardUpdated && ($scope.propertyadmin.item.letAgreed.boardUpdated !== 'No board')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.letAgreed.boardUpdated,
          type: $scope.propertyadmin.item.letAgreed.boardType,
          list: 'la'
        });
      }
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === $scope.propertyadmin.item.letAgreed.boardType) && (item.isWindow) && (item.list === 'la'));
    if (!windowItem) {
      if ($scope.propertyadmin.item.letAgreed.soldInWindow && ($scope.propertyadmin.item.letAgreed.soldInWindow === 'Yes')) {
        $scope.boardsList.save({
          address: $scope.property.item.displayAddress,
          RoleId: $scope.property.item.RoleId,
          PropertyId: $scope.property.item._id,
          date: $scope.propertyadmin.item.letAgreed.boardUpdated,
          type: 'LET_AGREED',
          isWindow: true,
          list: 'la'
        });
      }
    }
    $scope.propertyadmin.save();
    addNote('Let Agreed - ACTIONED');
    alert.log('Let Agreed details saved');
  }
  $scope.clearLADetails = function () {
    const board = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.date === $scope.propertyadmin.item.letAgreed.boardUpdated) && (item.type === $scope.propertyadmin.item.letAgreed.boardType) && (!item.isWindow));
    if (board) {
      $scope.boardsList.delete(board);
    }
    const windowItem = $scope.boardsList.items.find(item => (item.RoleId === $scope.propertyadmin.item.RoleId) && (item.type === $scope.propertyadmin.item.letAgreed.boardType) && (item.isWindow) && (item.list === 'la'));
    if (windowItem) {
      $scope.boardsList.delete(windowItem);
    }
    $scope.propertyadmin.item.letAgreed = null;
    $scope.propertyadmin.save();
    addNote('Let Agreed - CLEARED');
    alert.log('Let Agreed details cleared');
  }
  function sanitizeFilename(inputString, maxLength = 255) {
    // Replace invalid characters and commas with underscores
    const sanitizedString = inputString.replace(/[/?%*:|"<>,: ]+/g, '_');

    // Trim and limit the length of the filename
    const filename = sanitizedString.substring(0, maxLength).trim();

    return filename;
  }
  $scope.downloadPdf = function (isLetting) {
    // Define the HTML element that you want to convert to PDF
    const element = document.createElement('div');
    let html = `
      <style type="text/css">
        .mygrid, .details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-gap: 10px;
        }
        .mygrid h3 {
          background: #f15b25;
          color: white;
          font-weight: bold;
          grid-gap: 10px;
          padding: 0px 5px;
        }
      </style>
      <div class="title"><h3>${$scope.property.item.displayAddress}</h3><div class="date">${new Date().toDateString()}</div>
      <div class="mygrid">`;
    let titles = ['Instruction to Market', 'Sold Subject to Contract', 'Price Reduction', 'Fallen Through', 'Exchanged &amp; Completed', 'Withdrawn'];
    let selectors = ['.instruction-to-market', '.sold-subject-to-contract', '.price-reduction', '.fallen-through', '.exchanged-and-completed', '.withdrawn'];
    if(isLetting) {
      let titles = ['Instruction to Market', 'Let Agreed', 'Rental Completed'];
      let selectors = ['.instruction-to-market', '.let-agreed', '.exchanged-and-completed'];
    }
    html += selectors.map((selector, index) => {
      const details = Array.from(document.querySelectorAll(selector + ' .col-md-3')).map(elm => {
        const label = elm.querySelector('label');
        if (label && label.textContent.trim()) {
          const input = elm.querySelector('select,input');
          if (input && input.value && !input.value.includes('undefined')) {
            return '<label>' + label.textContent + '</label><div>' + (/\d{4}-\d{2}-\d{2}/.test(input.value) ? new Date(input.value).toDateString() : input.value) + '</div>';
          }
        }
        return null;
      }).filter(i => i);
      if (details.length) {
        return `<div><h3>${titles[index]}</h3><div class="details">${details.join('')}</div></div>`;
      }
      return null;
    }).filter(i => i).join('');
    html += '</div>';
    element.innerHTML = html;
    // Create configuration options for html2pdf
    const pdfOptions = {
      margin: 10,
      filename: sanitizeFilename($scope.property.item.displayAddress + '_' + new Date().toISOString().split('T')[0]) + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };

    // Use html2pdf to generate the PDF
    html2pdf()
      .from(element)
      .set(pdfOptions)
      .save();
  }
}
export {propertyAdminFunctions, initForSale};
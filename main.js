const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const ExcelJS = require('exceljs');
const { autoUpdater } = require('electron-updater');

const cookieJar = new CookieJar();
const client = wrapper(axios.create({ jar: cookieJar }));

let mainWindow = null;

// This could be called when your app starts
async function checkAccess() {
  try {
    // Make a POST request to your Lambda function
    const response = await axios.post('https://zkixgse8n3.execute-api.us-east-1.amazonaws.com/default/HTSNoteable', {
      // The app's identifier that is checked
      // Posted to Ed's Lambda function to make sure you're allowed to access
      
      appId: 'HTS'
    });

    // If the response status is 200 (HTTP OK), display the contents
    if (response.status === 200) {
      mainWindow.webContents.executeJavaScript(`
        document.getElementById('mainContainer').style.display = 'block';
      `);
    }
    // If the response status is something else, hide the contents
    else {
      mainWindow.webContents.executeJavaScript(`
        document.getElementById('mainContainer').style.display = 'none';
      `);
    }
  } catch (error) {
    console.error('An error occurred during access check:', error);
    // If there's an error, hide the contents
    mainWindow.webContents.executeJavaScript(`
      document.getElementById('mainContainer').style.display = 'none';
    `);
  }
}

function onReady() {
  mainWindow = createWindow();

    // Check for updates
  autoUpdater.checkForUpdatesAndNotify();

  // Call the checkAccess function when your app starts
  checkAccess();
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.executeJavaScript(`
      var rendererMfaChallengeToken = null;

      document.getElementById('mfaCode').style.display = 'none';

      document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const mfaCode = document.getElementById('mfaCode').value;
        const timezoneOffset = new Date().getTimezoneOffset();

        if (mfaCode && rendererMfaChallengeToken) {
          window.electron.send('complete-mfa', {token: rendererMfaChallengeToken, code: mfaCode});
        } else {
          window.electron.send('login-user', {email: email, password: password, offset: timezoneOffset});
        }
      });

      document.getElementById('reportForm').addEventListener('submit', (e) => {
        e.preventDefault();

        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        window.electron.send('search-reports', {startDate: startDate, endDate: endDate});
      });

      window.electron.receive('set-mfa-challenge-token', (token) => {
        rendererMfaChallengeToken = token;
      });
    `);
  });
}

app.on('ready', onReady);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

function createWindow() {
  let win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  return win;
}

ipcMain.on('login-user', async (event, args) => {
  await loginUser(args.email, args.password, args.offset);
});

ipcMain.on('complete-mfa', async (event, args) => {
  await completeMfa(args.token, args.code);
});

ipcMain.on('search-reports', async (event, args) => {
  await handleReportSearch(args.startDate, args.endDate);
});

async function loginUser(email, password, timezoneOffset) {
  try {
    const response = await client.post('https://www.mynoteable.com/Noteable.API/api/profile/login', {
      email: email,
      password: password,
      timezoneOffset: timezoneOffset
    });

    if (response.data.errors) {
      console.error('Login error:', response.data.errors);
    } else {
      if (response.data.MfaChallengeToken) {
        mainWindow.webContents.send('set-mfa-challenge-token', response.data.MfaChallengeToken);

        setTimeout(() => {
          initiateMfa(response.data.MfaChallengeToken, response.data.MfaChallengePhone);
        }, 1000);
      } else {
        handleSuccessfulLogin(response.data.sessionToken);
      }
    }
  } catch (error) {
    console.error('An error occurred during login:', error);
  }
}

async function initiateMfa(MfaChallengeToken, MfaChallengePhone) {
  try {
    const payload = {
      challengeToken: MfaChallengeToken,
      phoneNumber: MfaChallengePhone
    };

    console.log('Initiating MFA with payload:', payload);

    await client.post('https://www.mynoteable.com/Noteable.API/api/profile/mfa/initiate', payload);

    mainWindow.webContents.executeJavaScript(`
      document.getElementById('mfaLabel').style.display = 'flex';
      document.getElementById('mfaCode').style.display = 'flex';
    `);
  } catch (error) {
    console.error('An error occurred during MFA initiation:', error);
  }
}

async function completeMfa(challengeToken, mfaCode) {
  try {
    const response = await client.post('https://www.mynoteable.com/Noteable.API/api/profile/mfa/complete', {
      challengeToken: challengeToken,
      code: mfaCode
    });

    if (response.data.errors) {
      console.error('MFA completion error:', response.data.errors);
    } else {
      handleSuccessfulLogin(response.data);
    }
  } catch (error) {
    console.error('An error occurred during MFA completion:', error);
  }
}

function handleSuccessfulLogin(response) {
  sessionToken = response.SessionToken;
  console.log('successful login!', sessionToken);

  mainWindow.webContents.executeJavaScript(`
    document.getElementById('reportFinder').style.display = 'block';
  `);
}

async function handleReportSearch(startDate, endDate) {
  try {
    const response = await client.post('https://www.mynoteable.com/Noteable.API/api/clinicalreport/search', {
      clinicianIds: [],
      locationIds: [],
      startDate: startDate,
      endDate: endDate,
      programParams: []
    });

    if (response.data.errors) {
      console.error('Report search error:', response.data.errors);
    } else {
      console.log('Report search successful!', response.data);

      // Document types
      const docTypes = ['Service Registration Form', 'Initial SAR', 'Comprehensive Needs Assessment', 'Crisis Education and Prevention Plan', 'Fall Risk Assessment', 'Safety Plan', 
                         'Health History', 'Comprehensive Legals', 'Authorization for Release of Information', 'Discharge Summary', 'Freedom of Choice Form', 'Care Coordination Form', 
                         'Medication Verification', 'ISP', 'Risk Assessment', 'Treatment Plan'];

      // Initialize objects to store document status and authors
      let docStatus = {};
      let authors = {};

// Initialize object to store earliest dates
let earliestDates = {};

// Iterate over the response data
for (let item of response.data) {
  const clientName = item.ClientName;
  const documentName = item.Name;
  const author = item.Author;
  const createdDate = new Date(item.CreatedDate);
  
  // Extract case type from clientName
  const caseType = clientName.substring(clientName.lastIndexOf("(") + 1, clientName.lastIndexOf(")"));

  // If case type is not MCR or CS, skip this iteration
  if (caseType !== 'MCR' && caseType !== 'CS') continue;

  // If this client name is not yet in docStatus or authors, add it
  if (!docStatus.hasOwnProperty(clientName)) {
    docStatus[clientName] = {};
    for (let docType of docTypes) {
      if ((caseType === 'MCR' && ['ISP', 'Risk Assessment', 'Treatment Plan', 'Initial SAR'].includes(docType)) ||
          (caseType === 'CS' && docType === 'Service Registration Form')) {
        docStatus[clientName][docType] = 'N/A';
      } else {
        docStatus[clientName][docType] = 'NO';
      }
    }
    authors[clientName] = new Set();
    earliestDates[clientName] = createdDate;
  }

  // Check if this date is earlier than the currently stored date for this client
  if (createdDate < earliestDates[clientName]) {
    earliestDates[clientName] = createdDate;
  }

  // If the document is in our list of document types, mark it as 'IN'
  if (docTypes.includes(documentName) && docStatus[clientName][documentName] !== 'N/A') {
    docStatus[clientName][documentName] = 'IN';
  }

  // Add the author to the set of authors for this client
  authors[clientName].add(author);
}



      // Convert the authors sets to strings
      for (let clientName in authors) {
        authors[clientName] = [...authors[clientName]].join(", ");
      }

      // Create a new Excel workbook and sheet
      let workbook = new ExcelJS.Workbook();
      let worksheet = workbook.addWorksheet('Reports');

    // Add headers to the worksheet
worksheet.columns = [
  { header: 'Client Name', key: 'clientName' },
  { header: 'Start Date', key: 'startDate' },
  ...docTypes.map(docType => ({ header: docType, key: docType })),
  { header: 'Authors', key: 'authors' }
];

// Add the data to the worksheet
for (let clientName in docStatus) {
  let row = worksheet.addRow({ clientName: clientName, startDate: earliestDates[clientName].toLocaleDateString(), ...docStatus[clientName], authors: authors[clientName] });

  // Loop over the cells in the row
  for (let i = 2; i <= docTypes.length + 2; i++) {
    // Get cell value
    let value = row.getCell(i).text;

    if (value === 'IN') {
      // Format cell background if value is "IN"
      row.getCell(i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFB7E1CD' }
      };
    } else if (value === 'NO') {
      // Format cell background if value is "NO"
      row.getCell(i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF4C7C3' }
      };
    } else if (value === 'N/A') {
      // Format cell background if value is "N/A"
      row.getCell(i).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF808080' } // Dark gray
      };
    }
  }
}

// Format headers (row 1) to be bold with a background color of #004561 and text color of white
let headerRow = worksheet.getRow(1);
headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF004561' }
};

// Format 'Client Name' column header
headerRow.getCell(1).fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFF6F31' }
};

      // Write the workbook to a file
      await workbook.xlsx.writeFile('report.xlsx');

      console.log('Excel file has been written!');
    }
  } catch (error) {
    console.error('An error occurred during report search:', error);
  }
}


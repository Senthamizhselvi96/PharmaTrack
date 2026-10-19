# 💊 PharmaTrack
### Real-Time Pharmacy Medicine Availability & Reservation System

**PharmaTrack** is a MERN-stack web application designed to help patients find medicines at nearby pharmacies, check real-time stock availability, and reserve medicines before visiting a pharmacy.

The platform also provides pharmacy owners and staff with tools to manage medicine inventory, reservations, branches, and daily pharmacy operations.

## 📌 Problem Statement

Patients often visit multiple pharmacies to find essential medicines because they cannot check stock availability beforehand.

Traditional pharmacy inventory systems are generally designed for internal pharmacy management rather than providing patients with real-time medicine availability information.

PharmaTrack addresses this problem by connecting patients and pharmacies through a centralized, location-based medicine availability and reservation platform.

## 🎯 Project Objectives

- Enable patients to search for medicines by brand or generic name.
- Display nearby pharmacies with available medicine stock.
- Provide location-based pharmacy discovery and map navigation.
- Allow patients to reserve medicines before visiting.
- Help pharmacy owners and staff manage inventory efficiently.
- Maintain real-time stock and reservation updates.
- Reduce unnecessary pharmacy visits and improve medicine accessibility.

## 🚀 Key Features

### 👤 Patient Module

**Medicine Search**
- Search medicines using brand or generic names.
- View medicine prices and available quantities.
- Identify pharmacies carrying the required medicines.

**Location-Based Pharmacy Discovery**
- Search using the patient's current location.
- Search using the registered location.
- View nearby pharmacies and their distances.
- Explore pharmacy locations through an interactive map.
- Access directions to selected pharmacies.

**Medicine Reservations**
- Reserve medicines before visiting a pharmacy.
- Select the required quantity based on available stock.
- View and manage reservations.
- Track reservation status.
- Cancel reservations when permitted.

### 🏥 Pharmacy Owner Module

**Pharmacy Management**
- Register and manage pharmacy information.
- Manage pharmacy branches.
- Maintain branch-specific medicine inventory.

**Inventory Management**
- Add medicines with relevant details.
- Update medicine quantities and prices.
- Monitor available stock.
- Manage stock across pharmacy branches.

**Reservation Management**
- View patient medicine reservations.
- Monitor reservation status.
- Coordinate medicine collection.

**Branch Operations**
- Manage multiple pharmacy branches.
- Support inter-branch stock transfers.
- Review inventory and operational activity.

### 👨‍💼 Pharmacy Staff Module

- Access assigned pharmacy operations.
- Manage medicine stock.
- View and process reservations.
- Support inventory and branch workflows according to assigned permissions.

## ⚡ Real-Time Functionality

PharmaTrack uses Socket.IO to support real-time communication between the frontend and backend.

When inventory or reservation information changes, relevant dashboard information can update without requiring a manual page refresh.

The reservation workflow also includes stock management:

1. A patient searches for a medicine.
2. The system identifies pharmacies with available stock.
3. The patient selects a pharmacy and reservation quantity.
4. The backend validates availability.
5. The reservation is created and stock is reduced atomically.
6. The pharmacy receives the reservation update.
7. Reserved stock is held for a configured period.
8. If the reservation expires, the held stock is automatically returned.

The default reservation hold duration is configured using `HOLD_MINUTES=120`, representing two hours.

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React.js, Vite |
| UI | HTML5, CSS3, JavaScript |
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Authentication | JWT |
| Real-Time Communication | Socket.IO |
| Location-Based Search | MongoDB Geospatial Queries |
| Mapping | Interactive map integration, with Google Maps configuration support |
| Development Tools | VS Code, Git, GitHub |

## 🏗️ System Architecture

```text
                 PharmaTrack
                      |
              React.js Frontend
                      |
          -------------------------
          |           |           |
       Patient      Owner        Staff
          |           |           |
          -------------------------
                      |
              Express.js API
                      |
           Authentication (JWT)
                      |
                MongoDB Atlas
                      |
          -------------------------
          |           |           |
       Medicine    Pharmacy   Reservations
       Inventory   Locations
          |
     Socket.IO Updates
          |
   Real-Time Dashboard Sync
```

## 🔄 Application Workflow

### Patient Workflow

```text
Patient Registration / Login
             ↓
     Select Location
             ↓
      Search Medicine
             ↓
   View Nearby Pharmacies
             ↓
  Check Price & Availability
             ↓
       Reserve Medicine
             ↓
     Track Reservation
             ↓
   Visit Pharmacy for Pickup
```

### Pharmacy Workflow

```text
Pharmacy Registration / Login
              ↓
      Manage Pharmacy
              ↓
      Add Medicine Stock
              ↓
    Update Inventory Data
              ↓
   Receive Patient Reservations
              ↓
      Process Reservations
              ↓
    Maintain Updated Stock
```

## 📍 Location-Based Medicine Search

PharmaTrack uses geographic coordinates to identify nearby pharmacies.

MongoDB's `2dsphere` index supports geospatial queries, allowing the application to search pharmacy locations and calculate their proximity to a selected location.

Patients can choose between current and registered locations, making it possible to search for medicines in different areas.

The application supports interactive map visualization and pharmacy navigation. Google Maps functionality requires a configured API key; the map provider displayed depends on the current application configuration.

## 🔐 Authentication and Security

- Separate login and registration workflows for patients and pharmacies.
- JWT-based authentication.
- Protected application routes.
- Role-based access to relevant dashboard functionality.
- Backend validation for inventory and reservation operations.
- Environment variables for sensitive configuration.

**Security Note:** Actual API keys, MongoDB connection strings, JWT secrets, and `.env` files must never be committed to GitHub.

## 📁 Project Structure

The main application is organized into frontend and backend directories.

```text
PharmaTrack/
│
├── client/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── .env
│
├── server/
│   ├── package.json
│   └── .env
│
└── README.md
```

*This is a simplified structure. Individual component, route, model, and service folders depend on the current implementation.*

## ⚙️ Installation and Setup

### Prerequisites

Ensure the following are installed:

- Node.js and npm
- Git
- A MongoDB Atlas database or compatible MongoDB instance
- A code editor such as VS Code

### 1. Clone the Repository

```bash
git clone https://github.com/Senthamizhselvi96/PharmaTrack.git
cd PharmaTrack
```

### 2. Backend Setup

Navigate to the server directory:

```bash
cd server
npm install
```

Create a `.env` file inside `server/`:

```env
MONGO_URI=your-mongodb-connection-string
JWT_SECRET=your-secure-random-secret
PORT=5000
HOLD_MINUTES=120
CLIENT_URL=http://localhost:5173
```

Start the backend:

```bash
npm run dev
```

### 3. Frontend Setup

Open a new terminal and navigate to the client directory:

```bash
cd client
npm install
```

Create a `.env` file inside `client/`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

Start the frontend:

```bash
npm run dev
```

Open the local URL displayed by Vite in your browser.

### 4. Google Maps Configuration

If using Google Maps:

1. Create or select a Google Cloud project.
2. Enable the Maps JavaScript API.
3. Generate an API key.
4. Configure the key in the frontend environment.
5. Apply appropriate API key restrictions.

Depending on the current implementation, the application may use an alternative interactive map when Google Maps is not configured.

## 🧪 Testing the Application

To test the core functionality:

1. Register a pharmacy account and configure a pharmacy branch.
2. Add medicines with valid quantities and prices.
3. Register and log in as a patient.
4. Select a current or registered location.
5. Search for a medicine available at the pharmacy.
6. Verify the displayed stock, price, distance, and map location.
7. Create a reservation.
8. Verify the pharmacy receives the reservation.
9. Verify the available inventory decreases correctly.
10. Verify cancellation or expiry returns held stock where applicable.

Pharmacy search results are retrieved from database records rather than hardcoded medicine or pharmacy entries.

## 🌱 Future Enhancements

Potential future improvements include:

- AI-assisted medicine search and recommendations.
- Medicine alternatives based on generic composition.
- Predictive inventory demand analysis.
- Automated low-stock notifications.
- Improved multi-pharmacy coordination.
- Prescription upload and verification.
- Mobile application support.
- Advanced pharmacy analytics and reporting.

These are proposed enhancements and are not presented as currently implemented features.

## 🌍 Sustainable Development Goal

**SDG 3 — Good Health and Well-Being**

PharmaTrack supports the goal of improving access to healthcare resources by making medicine availability information easier to discover.

It aims to reduce unnecessary pharmacy visits and improve coordination between patients and pharmacies.

## 📌 Project Status

**Under Active Development**

PharmaTrack is being developed as a prototype pharmacy availability and reservation platform. Features and integrations may continue to evolve.

## 👩‍💻 Developer

**Senthamizhselvi**

Artificial Intelligence and Data Science

GitHub: [Senthamizhselvi96](https://github.com/Senthamizhselvi96)

---

**PharmaTrack — Find medicines. Check availability. Reserve with confidence.**
Overview
I am building a web app that allows a user to create a tea blend of up to three different types of tea.
The final tea blend will display the combined health effects of the teas included. 


Tech Stack
Frontend - Angular
Backend - node.js
Database - oracledb
Hosting - local

Data Models
herb
    id integer
    name string
    genus string
    species string
    description string
    other_names string

tea
    id integer
    name string
    description string
    herb_id integer (links to the data model herb's id)
    oxidation string
    effects array of strings    

Wireframe
tea_picker.drawio.xml
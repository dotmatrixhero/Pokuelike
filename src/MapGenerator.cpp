/*
 * File:   MapGenerator.cpp
 * Author: Brian
 *
 * Created on July 23, 2012, 10:28 PM
 */

#include "MapGenerator.h"
using namespace std;

MapGenerator::MapGenerator(int numberLayers) {
    TCODRandom* RNG = new TCODRandom();
    ofstream myfile;
    TCODBsp* myBSP = new TCODBsp(0,0,mapw, maph);

    if (true){ //i happen to use this map gen method
         int firstSplit = RNG->getInt(19,59);
        myBSP->splitOnce(false,firstSplit);
         TCODBsp *openSpace;
         TCODBsp *closedSpace;
         if(firstSplit>39 ){// this is one of many possible configurations. using bsp, half open, half closed style level.

                openSpace = myBSP->getLeft();
                closedSpace = myBSP->getRight();
         }else{
                openSpace = myBSP->getRight();
                closedSpace = myBSP->getLeft();
        }

         closedSpace->splitRecursive(NULL,3,5,12,1.5,1.2);
         openSpace->splitRecursive(NULL, 3, 4,10,1.5,1.5);

   }
    myfile.open("maptest2.txt");
    for(int x = 0; x<mapw; x++){
        for(int y = 0; y < maph; y++){
              myfile << "TILE-"<<x<<","<<y<< "\n";
             // myfile << "This is a line.\n";
              int x = RNG->getInt(0,20);
              if (x == 0)
                myfile << "none";
              if (x >= 1 && x < 8)
                  myfile << "grnd";
              if (x >= 8 && x <10)
                  myfile << "wall";
              if (x>=10 && x < 12)
                  myfile <<"watr";
              if (x>= 12 && x< 16)
                  myfile <<"cgrs";
              if (x>=16 && x < 18)
                  myfile <<"ctgs";
              if (x>=18 && x < 21)
                  myfile <<"wtsh";
              myfile<<"\n";
        }
    }
    myfile.close();


}

MapGenerator::MapGenerator(const MapGenerator& orig) {
}

MapGenerator::~MapGenerator() {
}


/*
 * File:   MapGenerator.cpp
 * Author: Brian
 *
 * Created on July 23, 2012, 10:28 PM
 */

#include "MapGenerator.h"
using namespace std;

MapGenerator::MapGenerator(int numberLayers, int layerNumber, TCODRandom* Rand)
{ //input string. to read file, to open file later....

RNG = Rand;
        //


   // genRandomTest();
   genBSP(numberLayers,layerNumber);

    write("maptest2.txt");
}
void MapGenerator::genRandomTest(){
    for(int x = 0; x<mapw; x++){
        for(int y = 0; y < maph; y++){
              int g = RNG->getInt(0,20);
              if (g == 0)
                 stringMap[x][y].replace(0,4, "airr");
              if (g >= 1 && g < 8)
                  stringMap[x][y].replace(0,4, "grnd");
              if (g >= 8 && g <10)
                  stringMap[x][y].replace(0,4, "wall");
              if (g>=10 && g < 12)
                  stringMap[x][y].replace(0,4,"watr");
              if (g>= 12 && g< 16)
                  stringMap[x][y].replace(0,4,"cgrs");
              if (g>=16 && g < 18)
                  stringMap[x][y].replace(0,4,"ctgs");
              if (g>=18 && g < 21)
                  stringMap[x][y].replace(0,4,"wtsh");

        }
    }


}

void MapGenerator::genBSP(int numberLayers, int layerNumber){
    if (layerNumber == 0){
        fillBox(0,0,mapw,maph,"watr");
    }
    else{
        fillBox(0,0,mapw,maph,"watr");
    }
    TCODBsp* myBSP = new TCODBsp(0,0,mapw, maph);

        int firstSplit = RNG->getInt(19,30);
        myBSP->splitOnce(false,firstSplit);
         TCODBsp *openSpace;
         TCODBsp *closedSpace;
   //      if(firstSplit>39 ){// this is one of many possible configurations. using bsp, half open, half closed style level.

     //           openSpace = myBSP->getLeft();
       //         closedSpace = myBSP->getRight();
         //}else{

                closedSpace = myBSP->getLeft();
                openSpace = myBSP->getRight();
        //}

         closedSpace->splitRecursive(NULL,4,8,8,1.8,1.4);
         openSpace->splitRecursive(NULL, 3,7 ,7,1.5,1.5);
        TCODBsp *temp = closedSpace;

        fillBSP(closedSpace);
        //connectBSP(closedSpace);
        myBSP->resize(0,0,mapw, maph);
}


void MapGenerator::fillBSP(TCODBsp* root){


        TCODBsp* temp = root;

        fillBox(temp->x,temp->y,temp->w,temp->h,"wall");


        if (temp->isLeaf()){
            std::cout<<temp->x<<", "<<temp->y<<"//"<<temp->w<<", "<<temp->h<<"\n";
            int offset = RNG->getInt(1, 2);
            temp->x = (temp->x)+offset;
            temp->w = RNG->getInt((temp->w)-3,(temp->w)-(offset+1));
            offset = RNG->getInt(1, 2);
            temp->y = (temp->y)+offset;
            temp->h = RNG->getInt((temp->h)-3,(temp->h)-(offset+1));
            fillBox(temp->x,temp->y,temp->w,temp->h,"grnd");
        }

     //   fillBox(temp->x,temp->y,temp->w,temp->h,"grnd");

         if (!temp->isLeaf()){
            fillBSP(temp->getLeft());
            fillBSP(temp->getRight());

            connectBSP(temp);

            }





}

void MapGenerator::connectBSP(TCODBsp* root){
        TCODBsp *temp = root;
        bool connectedRight;
        bool connectedLeft;
        int randNumOffset;
        int rightTry;
        int leftTry;
        if(!temp->horizontal){
            randNumOffset = RNG->getInt(temp->getLeft()->y+1, (temp->getLeft()->y+temp->getLeft()->h)-2);
            rightTry = temp->getLeft()->x+temp->getLeft()->w;
            leftTry = rightTry;
            for(int p = 0; p<((temp->w)/4);p++){
                stringMap[rightTry][randNumOffset].replace(0,4,"cgrs");//check before replacing in case it fails
                stringMap[leftTry][randNumOffset].replace(0,4,"cgrs"); //what if it's already in a room, surrounded by not wall? hmm
                if(numberSurrounding(rightTry, randNumOffset, "wall") < 3){
                    connectedRight = true;
                    rightTry--;
                }
                if(numberSurrounding(leftTry, randNumOffset, "wall") < 3){
                    connectedLeft = true;
                    leftTry++;
                }
                rightTry++;
                leftTry--;
            }

        }
        if(temp->horizontal){
            randNumOffset = RNG->getInt(temp->getLeft()->x+1, (temp->getLeft()->x+temp->getLeft()->w)-2);

            rightTry = temp->getLeft()->y+temp->getLeft()->h;
            leftTry = rightTry;
            for(int p = 0; p<((temp->h)/4);p++){
                stringMap[randNumOffset][rightTry].replace(0,4,"cgrs");
                stringMap[randNumOffset][leftTry].replace(0,4,"cgrs"); //what if it's already in a room, surrounded by not wall? hmm
                if(numberSurrounding(randNumOffset, rightTry, "wall") < 3){
                    connectedRight = true;
                    rightTry--;
                }
                if(numberSurrounding(randNumOffset, leftTry, "wall") < 3){
                    connectedLeft = true;
                    leftTry++;
                }
                rightTry++;
                leftTry--;
            }


        }

        if (!connectedRight || !connectedLeft){
            if(temp->horizontal){
                for(int p = 0; p<((temp->w)/3);p++){
                    stringMap[randNumOffset][rightTry].replace(0,4,"wtsh ");
                    stringMap[randNumOffset][leftTry].replace(0,4,"wtsh"); //what if it's already in a room, surrounded by not wall? hmm
                if(numberSurrounding(randNumOffset, rightTry, "wall") > 3){
                    rightTry--;
                }
                if(numberSurrounding(randNumOffset, leftTry, "wall") > 3){
                    leftTry++;
                }
                rightTry++;
                leftTry--;
                }
            }
        if(!temp->horizontal){
            for(int p = 0; p<((temp->h)/3);p++){
                stringMap[rightTry][randNumOffset].replace(0,4,"wtsh");//check before replacing in case it fails
                stringMap[leftTry][randNumOffset].replace(0,4,"wtsh"); //what if it's already in a room, surrounded by not wall? hmm
                if(numberSurrounding(rightTry+1, randNumOffset, "wall") > 3){
                    rightTry--;
                }
                if(numberSurrounding(leftTry-1, randNumOffset, "wall") > 3){
                    leftTry++;
                }
                rightTry++;
                leftTry--;
            }
        }

            connectBSP(root);
        }

}

void MapGenerator::write(const char* fileName){
    ofstream myfile;
    myfile.open(fileName);
   for(int x = 0; x<mapw; x++){
        for(int y = 0; y < maph; y++){
                myfile << "TILE-"<<x<<","<<y<< "\n";
                myfile << stringMap[x][y] <<"\n";
        }
   }
    myfile.close();
}

void MapGenerator::fillBox(int posx, int posy, int widthx, int heighty, string type){
  //  if ((posx+widthx) < mapw && (posy+heighty)< maph){
        for (int x = posx; x < widthx+posx; x++){
            for (int y = posy; y < heighty+posy; y++){
                stringMap[x][y].replace(0,4,type);

    //        }
        }

    }
}

int MapGenerator::numberSurrounding(int x, int y, string type){  //cardinal directions, not counting diagonals!
    int count = 0;
    if (x <= 0 || y <= 0 || x>= mapw || y >=maph){

        return 100;
        }
    if(stringMap[x-1][y].compare(type)==0)
        count++;
    if(stringMap[x+1][y].compare(type)==0)
        count++;
    if(stringMap[x][y-1].compare(type)==0)
        count++;
    if(stringMap[x][y+1].compare(type)==0)
        count++;

    return count;
}

MapGenerator::MapGenerator(const MapGenerator& orig) {
}

MapGenerator::~MapGenerator() {
}

